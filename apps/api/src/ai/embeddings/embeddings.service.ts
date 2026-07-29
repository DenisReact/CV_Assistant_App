/**
 * Fixed, not configurable. `chunks.embedding` is declared `vector(768)` in the
 * init migration and pgvector rejects any other width, so an env var here would
 * only let a deploy fail at insert time instead of at review time. Changing this
 * means writing a migration and re-embedding every chunk.
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * The port ingestion and retrieval embed through. Abstract class so it doubles
 * as the Nest injection token — the module binds it to a concrete provider, and
 * no other file may import an embeddings SDK.
 *
 * The two entry points are deliberately separate rather than one embed() with a
 * flag: documents and queries are embedded asymmetrically, and a flag callers
 * can forget is how retrieval quality quietly degrades.
 *
 * Contract for implementations: vectors are exactly EMBEDDING_DIMENSIONS wide
 * and unit-normalised — pgvector's cosine operator assumes it, and violations
 * do not error, they just return worse neighbours.
 */
export abstract class EmbeddingsService {
  /**
   * Recorded on every chunk at insert time, so a later model change can find
   * and re-embed the stale rows instead of silently comparing incompatible
   * vectors.
   */
  abstract get modelName(): string;

  /**
   * Embeds chunk text for storage. Returns one vector per input, in the same
   * order — ingestion zips the results back onto the chunks positionally, so a
   * reordered or short result would corrupt the index without erroring.
   */
  abstract embedDocuments(texts: string[]): Promise<number[][]>;

  /** Embeds a search query, which providers optimise differently to documents. */
  abstract embedQuery(text: string): Promise<number[]>;
}
