import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { SessionsService } from '../sessions/sessions.service';
import { DocumentKind, DocumentStatus } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import {
  FIT_RESPONSE_SCHEMA,
  FIT_SYSTEM_PROMPT,
  type FitBreakdown,
  validateFitBreakdown,
} from './fit.schema';

export interface FitAnalysisView {
  resumeId: string;
  jobId: string;
  jobTitle: string;
  label: string | null;
  overallScore: number;
  breakdown: FitBreakdown;
  model: string;
  computedAt: Date;
}

export interface SessionFitView {
  resumeId: string | null;
  jobs: {
    documentId: string;
    label: string;
    title: string;
    status: string;
    analysis: FitAnalysisView | null;
  }[];
}

const MAX_DOCUMENT_CHARS = 24000;

@Injectable()
export class FitService {
  private readonly logger = new Logger(FitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly sessions: SessionsService,
  ) {}

  async analyse(
    userId: string,
    resumeId: string,
    jobId: string,
    refresh = false,
  ): Promise<FitAnalysisView> {
    const resume = await this.loadDocument(
      userId,
      resumeId,
      DocumentKind.RESUME,
    );
    const job = await this.loadDocument(
      userId,
      jobId,
      DocumentKind.JOB_DESCRIPTION,
    );

    if (!refresh) {
      const cached = await this.prisma.fitAnalysis.findUnique({
        where: { resumeId_jobId: { resumeId, jobId } },
      });

      if (cached) {
        return {
          resumeId,
          jobId,
          jobTitle: job.title,
          label: null,
          overallScore: cached.overallScore,
          breakdown: cached.breakdown as unknown as FitBreakdown,
          model: cached.model,
          computedAt: cached.updatedAt,
        };
      }
    }

    const result = await this.llm.generateJson<FitBreakdown>({
      system: FIT_SYSTEM_PROMPT,
      schema: FIT_RESPONSE_SCHEMA,
      validate: validateFitBreakdown,
      temperature: 0.1,
      maxOutputTokens: 4096,
      turns: [
        {
          role: 'user',
          content: `Job description — "${job.title}":\n\n${this.truncate(job.rawText)}\n\n---\n\nResume — "${resume.title}":\n\n${this.truncate(resume.rawText)}`,
        },
      ],
    });

    // Prisma's Json input type requires an index signature, which a named
    // interface does not have. The value is plain JSON either way — it came out
    // of JSON.parse.
    const breakdown = result.data as unknown as Prisma.InputJsonValue;

    const stored = await this.prisma.fitAnalysis.upsert({
      where: { resumeId_jobId: { resumeId, jobId } },
      create: {
        resumeId,
        jobId,
        overallScore: result.data.overallScore,
        breakdown,
        model: result.model,
      },
      update: {
        overallScore: result.data.overallScore,
        breakdown,
        model: result.model,
      },
    });

    this.logger.log(
      `Scored resume ${resumeId} against job ${jobId}: ${result.data.overallScore}/100 in ${result.latencyMs}ms`,
    );

    return {
      resumeId,
      jobId,
      jobTitle: job.title,
      label: null,
      overallScore: stored.overallScore,
      breakdown: result.data,
      model: stored.model,
      computedAt: stored.updatedAt,
    };
  }

  async sessionFit(userId: string, sessionId: string): Promise<SessionFitView> {
    const session = await this.sessions.get(userId, sessionId);

    if (!session.resume) {
      return { resumeId: null, jobs: [] };
    }

    const resumeId = session.resume.id;

    const analyses = await this.prisma.fitAnalysis.findMany({
      where: {
        resumeId,
        jobId: { in: session.jobs.map((job) => job.documentId) },
      },
    });

    const byJobId = new Map(analyses.map((a) => [a.jobId, a]));

    return {
      resumeId,
      jobs: session.jobs.map((job) => {
        const analysis = byJobId.get(job.documentId);

        return {
          documentId: job.documentId,
          label: `Job #${job.label}`,
          title: job.title,
          status: job.status,
          analysis: analysis
            ? {
                resumeId,
                jobId: job.documentId,
                jobTitle: job.title,
                label: `Job #${job.label}`,
                overallScore: analysis.overallScore,
                breakdown: analysis.breakdown as unknown as FitBreakdown,
                model: analysis.model,
                computedAt: analysis.updatedAt,
              }
            : null,
        };
      }),
    };
  }

  async analyseSession(
    userId: string,
    sessionId: string,
    refresh = false,
  ): Promise<SessionFitView> {
    const session = await this.sessions.get(userId, sessionId);

    if (!session.resume) {
      throw new BadRequestException(
        'Attach a resume to this session before running a fit analysis',
      );
    }

    for (const job of session.jobs) {
      if (job.status !== DocumentStatus.READY) {
        this.logger.warn(
          `Skipping job ${job.documentId}: status is ${job.status}`,
        );
        continue;
      }

      await this.analyse(userId, session.resume.id, job.documentId, refresh);
    }

    return this.sessionFit(userId, sessionId);
  }

  private async loadDocument(
    userId: string,
    documentId: string,
    kind: DocumentKind,
  ) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    if (document.kind !== kind) {
      throw new BadRequestException(
        `Document ${documentId} is a ${document.kind}, expected ${kind}`,
      );
    }

    return document;
  }

  private truncate(text: string): string {
    if (text.length <= MAX_DOCUMENT_CHARS) {
      return text;
    }

    return `${text.slice(0, MAX_DOCUMENT_CHARS)}\n\n[truncated]`;
  }
}
