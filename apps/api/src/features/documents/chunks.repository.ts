import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EMBEDDING_DIMENSIONS } from '../../ai/embeddings/embeddings.service';

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
  /** Joined from the parent document so callers can label evidence in one pass. */
  documentTitle: string;
  documentKind: string;
  /** Cosine similarity in [0, 1], higher is closer. */
  score: number;
}

/** Keeps the placeholder arithmetic below honest if a column is ever added. */
const COLUMNS_PER_ROW = 6;

/**
 * Bounded so a large document cannot build a single statement with tens of
 * thousands of bind parameters — Postgres caps those at 65535, and the failure
 * would only appear for the biggest uploads.
 */
const INSERT_BATCH_SIZE = 500;

/**
 * Data access for the `chunks` table — the vector store.
 *
 * Raw SQL rather than the Prisma query API throughout, because `vector` is a
 * pgvector type Prisma has no mapping for: it cannot write the column or use
 * the `<=>` distance operator that the HNSW index is built on. Isolating that
 * here keeps hand-written SQL to one file with a typed surface over it.
 *
 * Every query is parameterised. The `Unsafe` in the Prisma method names refers
 * to the SQL string being built at runtime, not to interpolated values — none
 * of the values below are interpolated.
 */
@Injectable()
export class ChunksRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Replaces a document's chunks wholesale, delete-then-insert in one
   * transaction.
   *
   * Replace rather than upsert because re-ingestion may produce a different
   * number of chunks: leftover rows from a previous run would stay searchable
   * and cite text the document no longer contains. The transaction is what
   * makes the window between delete and insert invisible to a concurrent
   * search.
   *
   * Widths are checked before the transaction opens — pgvector would reject a
   * wrong-width vector anyway, but mid-insert, after the old chunks are already
   * gone.
   */
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

  /**
   * Nearest-neighbour search over the user's own chunks.
   *
   * The `documents` join is the tenant boundary: ownership lives on the parent
   * document, so filtering by `user_id` here means a chunk belonging to someone
   * else cannot be reached even if its vector is the closest match. This is the
   * only place that guarantee is enforced, and it is enforced in SQL rather
   * than by filtering results afterwards.
   *
   * Ordering uses the raw `<=>` distance so the HNSW index can serve the query;
   * `score` is the same comparison expressed as similarity for callers. An
   * explicit empty `documentIds` returns immediately — as SQL it would produce
   * `= ANY('{}')`, which matches nothing but still pays for a query.
   */
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

  /**
   * The chunks surrounding a given one, for widening a hit back out to its
   * context.
   *
   * `score` is a literal zero: these were fetched by position, not similarity,
   * and returning a plausible-looking number for them would let a caller sort
   * or threshold on a value that means nothing. Same tenant join as
   * {@link search}.
   */
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

  /**
   * Formats a vector the way pgvector parses it: `[0.1,0.2,...]`, passed as a
   * bound string and cast with `::vector` at the call site. There is no driver
   * type for this, so the format is written by hand — and therefore in exactly
   * one place.
   */
  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
