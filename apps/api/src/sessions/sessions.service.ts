import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentKind } from '../generated/prisma/enums';

export interface SessionJobView {
  documentId: string;
  label: number;
  title: string;
  status: string;
  chunkCount: number;
}

export interface SessionContext {
  resumeId: string | null;
  /** The resume first, then jobs in label order. Bounds what retrieval may see. */
  documentIds: string[];
  /** Document id to the name the user calls it: "Resume", "Job #2". */
  labels: Map<string, string>;
  /** Label ordinal back to document id, for resolving "Job #2" in a question. */
  jobIdsByLabel: Map<number, string>;
}

export interface SessionView {
  id: string;
  title: string | null;
  resume: {
    id: string;
    title: string;
    status: string;
    chunkCount: number;
  } | null;
  jobs: SessionJobView[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    input: { resumeId?: string; jobIds?: string[]; title?: string },
  ): Promise<SessionView> {
    if (input.resumeId) {
      await this.assertOwnedDocument(
        userId,
        input.resumeId,
        DocumentKind.RESUME,
      );
    }

    const jobIds = this.dedupe(input.jobIds ?? []);

    for (const jobId of jobIds) {
      await this.assertOwnedDocument(
        userId,
        jobId,
        DocumentKind.JOB_DESCRIPTION,
      );
    }

    const session = await this.prisma.chatSession.create({
      data: {
        userId,
        resumeId: input.resumeId ?? null,
        title: input.title?.trim() || null,
        jobs: {
          create: jobIds.map((documentId, index) => ({
            documentId,
            label: index + 1,
          })),
        },
      },
    });

    return this.get(userId, session.id);
  }

  async list(userId: string): Promise<SessionView[]> {
    const sessions = await this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: this.include,
    });

    return sessions.map((session) => this.toView(session));
  }

  async get(userId: string, sessionId: string): Promise<SessionView> {
    return this.toView(await this.findOwned(userId, sessionId));
  }

  async update(
    userId: string,
    sessionId: string,
    input: { resumeId?: string; title?: string },
  ): Promise<SessionView> {
    await this.findOwned(userId, sessionId);

    if (input.resumeId) {
      await this.assertOwnedDocument(
        userId,
        input.resumeId,
        DocumentKind.RESUME,
      );
    }

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        ...(input.resumeId ? { resumeId: input.resumeId } : {}),
        ...(input.title !== undefined
          ? { title: input.title.trim() || null }
          : {}),
      },
    });

    return this.get(userId, sessionId);
  }

  async addJob(
    userId: string,
    sessionId: string,
    documentId: string,
  ): Promise<SessionView> {
    await this.findOwned(userId, sessionId);
    await this.assertOwnedDocument(
      userId,
      documentId,
      DocumentKind.JOB_DESCRIPTION,
    );

    const existing = await this.prisma.chatSessionJob.findUnique({
      where: { sessionId_documentId: { sessionId, documentId } },
    });

    if (existing) {
      throw new ConflictException(
        `That job description is already attached as #${existing.label}`,
      );
    }

    const highest = await this.prisma.chatSessionJob.findFirst({
      where: { sessionId },
      orderBy: { label: 'desc' },
      select: { label: true },
    });

    await this.prisma.chatSessionJob.create({
      data: { sessionId, documentId, label: (highest?.label ?? 0) + 1 },
    });

    await this.touch(sessionId);

    return this.get(userId, sessionId);
  }

  async removeJob(
    userId: string,
    sessionId: string,
    documentId: string,
  ): Promise<SessionView> {
    await this.findOwned(userId, sessionId);

    await this.prisma.chatSessionJob.deleteMany({
      where: { sessionId, documentId },
    });

    await this.touch(sessionId);

    return this.get(userId, sessionId);
  }

  async remove(userId: string, sessionId: string): Promise<void> {
    await this.findOwned(userId, sessionId);

    await this.prisma.chatSession.delete({ where: { id: sessionId } });
  }

  /**
   * Everything the chat layer needs about a session, in one query.
   *
   * `documentIds` bounds retrieval, so an answer in this session can never quote
   * a posting the user is comparing in another. `labels` names each document the
   * way the user does, and `jobIdsByLabel` is the reverse lookup that lets a
   * question mentioning "Job #2" be scoped to that job alone.
   */
  async context(userId: string, sessionId: string): Promise<SessionContext> {
    const session = await this.findOwned(userId, sessionId);

    const labels = new Map<string, string>();
    const jobIdsByLabel = new Map<number, string>();

    if (session.resumeId) {
      labels.set(session.resumeId, 'Resume');
    }

    for (const job of session.jobs) {
      labels.set(job.documentId, `Job #${job.label}`);
      jobIdsByLabel.set(job.label, job.documentId);
    }

    const documentIds = session.jobs.map((job) => job.documentId);

    if (session.resumeId) {
      documentIds.unshift(session.resumeId);
    }

    return {
      resumeId: session.resumeId,
      documentIds,
      labels,
      jobIdsByLabel,
    };
  }

  private async findOwned(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      include: this.include,
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    return session;
  }

  private async assertOwnedDocument(
    userId: string,
    documentId: string,
    kind: DocumentKind,
  ): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { kind: true },
    });

    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    if (document.kind !== kind) {
      throw new BadRequestException(
        `Document ${documentId} is a ${document.kind}, expected ${kind}`,
      );
    }
  }

  private async touch(sessionId: string): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  private dedupe(ids: string[]): string[] {
    return [...new Set(ids)];
  }

  private get include() {
    return {
      resume: {
        select: { id: true, title: true, status: true, chunkCount: true },
      },
      jobs: {
        orderBy: { label: 'asc' as const },
        include: {
          document: {
            select: { id: true, title: true, status: true, chunkCount: true },
          },
        },
      },
    };
  }

  private toView(session: {
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
    resume: {
      id: string;
      title: string;
      status: string;
      chunkCount: number;
    } | null;
    jobs: {
      documentId: string;
      label: number;
      document: {
        id: string;
        title: string;
        status: string;
        chunkCount: number;
      };
    }[];
  }): SessionView {
    return {
      id: session.id,
      title: session.title,
      resume: session.resume,
      jobs: session.jobs.map((job) => ({
        documentId: job.documentId,
        label: job.label,
        title: job.document.title,
        status: job.document.status,
        chunkCount: job.document.chunkCount,
      })),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
