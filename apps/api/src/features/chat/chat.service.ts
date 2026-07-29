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

const HISTORY_WINDOW = 10;

const EXCERPT_LENGTH = 400;

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

  async ask(
    userId: string,
    sessionId: string,
    question: string,
  ): Promise<MessageView> {
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
      latencyMs: result.latencyMs,
    });
  }

  private async standaloneQuestion(
    question: string,
    priorTurns: LlmTurn[],
  ): Promise<string> {
    if (priorTurns.length === 0) {
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
