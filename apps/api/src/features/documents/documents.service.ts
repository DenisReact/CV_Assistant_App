import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingsService } from '../../ai/embeddings/embeddings.service';
import { ChunkingService } from '../../rag/ingestion/chunking.service';
import { TextExtractionService } from '../../rag/ingestion/text-extraction.service';
import { ChunksRepository } from './chunks.repository';
import { DocumentKind, DocumentStatus } from '../../generated/prisma/enums';
import type { Document } from '../../generated/prisma/client';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: TextExtractionService,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunksRepository,
  ) {}

  async upload(
    userId: string,
    file: UploadedFile,
    kind: DocumentKind,
    title?: string,
  ): Promise<Document> {
    const rawText = await this.extraction.extract(
      file.buffer,
      file.mimetype,
      file.originalname,
    );

    const document = await this.prisma.document.create({
      data: {
        userId,
        kind,
        title: title?.trim() || this.titleFromFilename(file.originalname),
        rawText,
        status: DocumentStatus.PENDING,
        sourceFilename: file.originalname,
        byteSize: file.size,
      },
    });

    this.scheduleProcessing(document.id);

    return document;
  }

  async reprocess(userId: string, documentId: string): Promise<Document> {
    const document = await this.findOwned(userId, documentId);

    this.scheduleProcessing(document.id);

    return document;
  }

  async list(userId: string, kind?: DocumentKind): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { userId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(userId: string, documentId: string): Promise<Document> {
    return this.findOwned(userId, documentId);
  }

  async remove(userId: string, documentId: string): Promise<void> {
    await this.findOwned(userId, documentId);

    await this.prisma.document.delete({ where: { id: documentId } });
  }

  private async findOwned(
    userId: string,
    documentId: string,
  ): Promise<Document> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    return document;
  }

  private scheduleProcessing(documentId: string): void {
    void this.process(documentId).catch((error: unknown) => {
      this.logger.error(
        `Unhandled failure while processing document ${documentId}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private async process(documentId: string): Promise<void> {
    const started = Date.now();

    try {
      const document = await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.PROCESSING, error: null },
      });

      const textChunks = this.chunking.chunk(document.rawText);

      if (textChunks.length === 0) {
        throw new Error('Document produced no chunks');
      }

      const vectors = await this.embeddings.embedDocuments(
        textChunks.map((chunk) => chunk.content),
      );

      await this.chunks.replaceForDocument(
        documentId,
        textChunks.map((chunk, index) => ({
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embedding: vectors[index],
        })),
        this.embeddings.modelName,
      );

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.READY,
          chunkCount: textChunks.length,
          error: null,
        },
      });

      this.logger.log(
        `Indexed document ${documentId}: ${textChunks.length} chunks in ${Date.now() - started}ms`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to index document ${documentId}: ${message}`);

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.FAILED,
          error: message.slice(0, 500),
          chunkCount: 0,
        },
      });
    }
  }

  private titleFromFilename(filename: string): string {
    return filename.replace(/\.[^./\\]+$/, '').trim() || filename;
  }
}
