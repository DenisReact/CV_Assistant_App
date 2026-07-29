import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService, type LlmTurn } from 'src/ai/llm/llm.service';
import {
  RetrievalService,
  type CitedChunk,
} from 'src/rag/retrieval/retrieval.service';
import { SessionsService } from '../sessions/sessions.service';
import { MessageRole } from '../../generated/prisma/enums';
import { narrowToNamedJobs } from './narrow-to-named-jobs';
import { needsRewrite } from './needs-rewrite';
import {
  ANSWER_SYSTEM_PROMPT,
  NO_DOCUMENTS_ANSWER,
  NO_EVIDENCE_ANSWER,
  REWRITE_SYSTEM_PROMPT,
  buildAnswerPrompt,
} from 'src/features/chat/prompts';

export interface CitationView {
  position: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  label: string;
  chunkIndex: number;
  score: number;
  excerpt: string;
}

export interface MessageView {
  id: string;
  role: MessageRole;
  content: string;
  citations: CitationView[];
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  createdAt: Date;
}

/**
 * Turns of history sent to the model and used for query rewriting. Enough to
 * resolve "the second one" against what was just discussed, bounded so a long
 * session cannot grow the prompt until it crowds out the retrieved evidence.
 */
const HISTORY_WINDOW = 10;

/** How much of a cited chunk the UI shows; the full chunk stays in the database. */
const EXCERPT_LENGTH = 400;

/**
 * Orchestrates the query path: rewrite, retrieve, generate, persist.
 *
 * The RAG steps themselves belong to {@link RetrievalService} and the LLM port —
 * what lives here is the sequencing, the two short-circuits that avoid calling
 * the model when there is nothing to reason over, and the persistence of
 * answers with the evidence and telemetry behind them.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly retrieval: RetrievalService,
    private readonly llm: LlmService,
  ) {}

  async history(userId: string, sessionId: string): Promise<MessageView[]> {
    // Doubles as the ownership check: throws before any message is read.
    const { labels } = await this.sessions.context(userId, sessionId);

    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: {
        citations: {
          orderBy: { rank: 'asc' },
          include: {
            chunk: {
              include: { document: { select: { id: true, title: true } } },
            },
          },
        },
      },
    });

    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      citations: message.citations.map((citation) => ({
        position: citation.rank,
        chunkId: citation.chunkId,
        documentId: citation.chunk.document.id,
        documentTitle: citation.chunk.document.title,
        label: labels.get(citation.chunk.document.id) ?? 'Document',
        chunkIndex: citation.chunk.chunkIndex,
        score: citation.score,
        excerpt: citation.chunk.content.slice(0, EXCERPT_LENGTH),
      })),
      model: message.model,
      promptTokens: message.promptTokens,
      completionTokens: message.completionTokens,
      latencyMs: message.latencyMs,
      createdAt: message.createdAt,
    }));
  }

  /**
   * Answers a question against the session's documents.
   *
   * History is read *before* the question is persisted, so the rewrite step
   * sees the conversation as it stood when the question was asked rather than
   * finding the question already in its own context.
   *
   * Both early returns are deliberate: with no documents, or with nothing above
   * the relevance floor, a canned answer is stored without calling the model at
   * all. There is no evidence in either case, so a generated answer could only
   * be invention — and this way it costs nothing. Both are recorded as real
   * messages with no citations, which keeps the transcript honest about what
   * was asked and what came back.
   *
   * Latency is measured across the whole method, not around the generation
   * call, so what is stored and shown is what the user actually waited for —
   * rewrite, embedding and database work included.
   */
  async ask(
    userId: string,
    sessionId: string,
    question: string,
  ): Promise<MessageView> {
    const started = Date.now();

    const session = await this.sessions.context(userId, sessionId);
    const labels = session.labels;

    const priorTurns = await this.recentTurns(sessionId);

    await this.persistUserMessage(sessionId, question);

    if (session.documentIds.length === 0) {
      return this.persistAnswer(sessionId, NO_DOCUMENTS_ANSWER, [], labels);
    }

    const searchQuery = await this.standaloneQuestion(question, priorTurns);

    const { chunks, context } = await this.retrieval.retrieve({
      userId,
      query: searchQuery,
      documentIds: narrowToNamedJobs(searchQuery, session),
      labels,
    });

    if (chunks.length === 0) {
      this.logger.debug(
        `No chunks above the relevance floor for session ${sessionId}`,
      );

      return this.persistAnswer(sessionId, NO_EVIDENCE_ANSWER, [], labels);
    }

    const result = await this.llm.generate({
      system: ANSWER_SYSTEM_PROMPT,
      turns: [
        ...priorTurns,
        { role: 'user', content: buildAnswerPrompt(question, context) },
      ],
    });

    return this.persistAnswer(sessionId, result.text, chunks, labels, {
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: Date.now() - started,
    });
  }

  /**
   * Rewrites a follow-up into a question that stands on its own, for retrieval.
   *
   * Only the rewritten form is used to search; the model still answers the
   * user's original wording, so a rewrite that shifts the emphasis slightly
   * cannot change what the user sees being answered.
   *
   * A failure here degrades to the raw question rather than failing the
   * request. Searching with "what about the second one?" retrieves poorly, but
   * an error page for a question the user can see is answerable is worse — and
   * this is an auxiliary call, not the one they asked for.
   *
   * Skipped entirely when the question has nothing to resolve, because this
   * costs a generation every time it runs. See {@link needsRewrite}.
   */
  private async standaloneQuestion(
    question: string,
    priorTurns: LlmTurn[],
  ): Promise<string> {
    if (!needsRewrite(question, priorTurns.length)) {
      return question;
    }

    try {
      const result = await this.llm.generate({
        system: REWRITE_SYSTEM_PROMPT,
        turns: [...priorTurns, { role: 'user', content: question }],
        temperature: 0,
        maxOutputTokens: 256,
      });

      const rewritten = result.text.trim();

      if (rewritten.length === 0) {
        return question;
      }

      if (rewritten !== question) {
        this.logger.debug(`Rewrote "${question}" as "${rewritten}"`);
      }

      return rewritten;
    } catch (error) {
      this.logger.warn(
        `Query rewrite failed, searching with the raw question: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return question;
    }
  }

  private async recentTurns(sessionId: string): Promise<LlmTurn[]> {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_WINDOW,
      select: { role: true, content: true },
    });

    return messages.reverse().map((message) => ({
      role: message.role === MessageRole.USER ? 'user' : 'assistant',
      content: message.content,
    }));
  }

  private async persistUserMessage(
    sessionId: string,
    content: string,
  ): Promise<void> {
    await this.prisma.message.create({
      data: { sessionId, role: MessageRole.USER, content },
    });
  }

  /**
   * Stores the answer together with the evidence and the cost of producing it.
   *
   * Citations keep the rank and score retrieval assigned, so an answer stays
   * auditable after the fact: what was retrieved, how confident the match was,
   * and which chunk each `[n]` marker refers to. That is also the only way to
   * evaluate retrieval quality on real traffic rather than by re-running
   * queries and hoping the index has not changed.
   *
   * Telemetry is absent for the canned answers, which is the intended
   * distinction — a null model means no generation happened.
   */
  private async persistAnswer(
    sessionId: string,
    content: string,
    chunks: CitedChunk[],
    labels: Map<string, string>,
    telemetry?: {
      model: string;
      promptTokens: number | null;
      completionTokens: number | null;
      latencyMs: number;
    },
  ): Promise<MessageView> {
    const message = await this.prisma.message.create({
      data: {
        sessionId,
        role: MessageRole.ASSISTANT,
        content,
        model: telemetry?.model ?? null,
        promptTokens: telemetry?.promptTokens ?? null,
        completionTokens: telemetry?.completionTokens ?? null,
        latencyMs: telemetry?.latencyMs ?? null,
        citations: {
          create: chunks.map((chunk) => ({
            chunkId: chunk.chunkId,
            rank: chunk.position,
            score: chunk.score,
          })),
        },
      },
    });

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return {
      id: message.id,
      role: message.role,
      content: message.content,
      citations: chunks.map((chunk) => ({
        position: chunk.position,
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        label: labels.get(chunk.documentId) ?? 'Document',
        chunkIndex: chunk.chunkIndex,
        score: chunk.score,
        excerpt: chunk.content.slice(0, EXCERPT_LENGTH),
      })),
      model: message.model,
      promptTokens: message.promptTokens,
      completionTokens: message.completionTokens,
      latencyMs: message.latencyMs,
      createdAt: message.createdAt,
    };
  }
}
