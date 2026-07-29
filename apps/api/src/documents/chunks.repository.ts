import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EMBEDDING_DIMENSIONS } from '../embeddings/embeddings.service';

export interface ChunkRow {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[];
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  documentTitle: string;
  documentKind: string;
  score: number;
}

const COLUMNS_PER_ROW = 6;

const INSERT_BATCH_SIZE = 500;

@Injectable()
export class ChunksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async replaceForDocument(
    documentId: string,
    chunks: ChunkRow[],
    embeddingModel: string,
  ): Promise<void> {
    for (const chunk of chunks) {
      if (chunk.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Chunk ${chunk.chunkIndex} has ${chunk.embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.chunk.deleteMany({ where: { documentId } });

      for (let start = 0; start < chunks.length; start += INSERT_BATCH_SIZE) {
        const batch = chunks.slice(start, start + INSERT_BATCH_SIZE);

        const values = batch
          .map((_, row) => {
            const base = row * COLUMNS_PER_ROW;
            return `(gen_random_uuid(), $${base + 1}::uuid, $${base + 2}::int, $${base + 3}::text, $${base + 4}::int, $${base + 5}::vector, $${base + 6}::text)`;
          })
          .join(', ');

        const params = batch.flatMap((chunk) => [
          documentId,
          chunk.chunkIndex,
          chunk.content,
          chunk.tokenCount,
          this.toVectorLiteral(chunk.embedding),
          embeddingModel,
        ]);

        await tx.$executeRawUnsafe(
          `INSERT INTO "chunks" ("id", "document_id", "chunk_index", "content", "token_count", "embedding", "embedding_model")
           VALUES ${values}`,
          ...params,
        );
      }
    });
  }

  async search(params: {
    userId: string;
    embedding: number[];
    limit: number;
    documentIds?: string[];
  }): Promise<RetrievedChunk[]> {
    const { userId, embedding, limit, documentIds } = params;

    if (documentIds && documentIds.length === 0) {
      return [];
    }

    const vector = this.toVectorLiteral(embedding);
    const bindings: unknown[] = [vector, userId];

    let documentFilter = '';

    if (documentIds) {
      bindings.push(documentIds);
      documentFilter = `AND c."document_id" = ANY($${bindings.length}::uuid[])`;
    }

    bindings.push(limit);

    return await this.prisma.$queryRawUnsafe<RetrievedChunk[]>(
      `SELECT c."id"           AS "chunkId",
              c."document_id"  AS "documentId",
              c."chunk_index"  AS "chunkIndex",
              c."content"      AS "content",
              c."token_count"  AS "tokenCount",
              d."title"        AS "documentTitle",
              d."kind"::text   AS "documentKind",
              1 - (c."embedding" <=> $1::vector) AS "score"
         FROM "chunks" c
         JOIN "documents" d ON d."id" = c."document_id"
        WHERE d."user_id" = $2::uuid
          AND c."embedding" IS NOT NULL
          ${documentFilter}
        ORDER BY c."embedding" <=> $1::vector
        LIMIT $${bindings.length}`,
      ...bindings,
    );
  }

  async neighbours(
    userId: string,
    documentId: string,
    chunkIndex: number,
    radius: number,
  ): Promise<RetrievedChunk[]> {
    return await this.prisma.$queryRawUnsafe<RetrievedChunk[]>(
      `SELECT c."id"           AS "chunkId",
              c."document_id"  AS "documentId",
              c."chunk_index"  AS "chunkIndex",
              c."content"      AS "content",
              c."token_count"  AS "tokenCount",
              d."title"        AS "documentTitle",
              d."kind"::text   AS "documentKind",
              0::float8        AS "score"
         FROM "chunks" c
         JOIN "documents" d ON d."id" = c."document_id"
        WHERE d."user_id" = $1::uuid
          AND c."document_id" = $2::uuid
          AND c."chunk_index" BETWEEN $3 AND $4
        ORDER BY c."chunk_index"`,
      userId,
      documentId,
      chunkIndex - radius,
      chunkIndex + radius,
    );
  }

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
