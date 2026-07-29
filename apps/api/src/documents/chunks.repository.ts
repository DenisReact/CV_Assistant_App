import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EMBEDDING_DIMENSIONS } from '../embeddings/embeddings.service';

export interface ChunkRow {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[];
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

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
