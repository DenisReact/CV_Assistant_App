import { Injectable } from '@nestjs/common';

export interface TextChunk {
  /** Position in the document, and the ordering key for neighbour lookups. */
  chunkIndex: number;
  content: string;
  /** Estimated, not exact — see {@link ChunkingService.estimateTokens}. */
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

/**
 * Roughly one resume section or one requirements block. Small enough that a
 * retrieved chunk is mostly about one thing, large enough that a bullet keeps
 * the heading it belongs under.
 */
const DEFAULT_TARGET_TOKENS = 300;

/**
 * Carried from the end of each chunk into the next, so a fact split across a
 * boundary is still wholly present in one of them. Retrieval matches whole
 * chunks; a sentence cut in half can end up findable in neither.
 */
const DEFAULT_OVERLAP_TOKENS = 60;

/**
 * A paragraph is only broken up when it alone exceeds the target by this much.
 * Mild overshoot is preferable to splitting mid-thought, so the target behaves
 * as a goal for packing and this as the actual hard limit.
 */
const HARD_SPLIT_MULTIPLIER = 1.5;

/**
 * Splits extracted document text into embeddable chunks, paragraph-first with a
 * sentence-level fallback.
 *
 * The strategy suits the corpus: resumes and job descriptions are already
 * sectioned into headings, bullets and short paragraphs, so blank lines are
 * where the semantic boundaries genuinely are. A fixed-width sliding window
 * would cut through them arbitrarily and produce chunks that straddle two
 * unrelated roles.
 *
 * Pure and synchronous by design — no I/O, no provider calls — which is what
 * makes boundary behaviour cheap to test directly.
 */
@Injectable()
export class ChunkingService {
  /**
   * Packs whole units into chunks up to `targetTokens`, carrying `overlapTokens`
   * of trailing context into each successive chunk.
   *
   * Returns an empty array for empty or whitespace-only input rather than one
   * blank chunk; ingestion treats that as a failed document, because embedding
   * nothing would produce a READY document that can never be retrieved.
   */
  chunk(text: string, options: ChunkOptions = {}): TextChunk[] {
    const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
    const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;

    const units = this.splitIntoUnits(
      text,
      targetTokens * HARD_SPLIT_MULTIPLIER,
    );
    const chunks: TextChunk[] = [];

    let current: string[] = [];
    let currentTokens = 0;

    const flush = (): void => {
      if (current.length === 0) {
        return;
      }

      const content = current.join('\n\n').trim();

      if (content.length > 0) {
        chunks.push({
          chunkIndex: chunks.length,
          content,
          tokenCount: this.estimateTokens(content),
        });
      }

      current = [];
      currentTokens = 0;
    };

    for (const unit of units) {
      const unitTokens = this.estimateTokens(unit);

      if (currentTokens > 0 && currentTokens + unitTokens > targetTokens) {
        const carry = this.tail(current, overlapTokens);
        flush();
        current = [...carry];
        currentTokens = carry.reduce(
          (sum, u) => sum + this.estimateTokens(u),
          0,
        );
      }

      current.push(unit);
      currentTokens += unitTokens;
    }

    flush();

    return chunks;
  }

  /**
   * Reduces the document to atoms the packer may not split further: paragraphs,
   * or sentence groups where a paragraph was too long to keep whole.
   *
   * Separating this from packing is what keeps the boundary rule in one place —
   * the packer never has to decide whether it is allowed to break something.
   */
  private splitIntoUnits(text: string, maxUnitTokens: number): string[] {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const units: string[] = [];

    for (const paragraph of paragraphs) {
      if (this.estimateTokens(paragraph) <= maxUnitTokens) {
        units.push(paragraph);
        continue;
      }

      units.push(...this.splitLongParagraph(paragraph, maxUnitTokens));
    }

    return units;
  }

  /**
   * Fallback for the paragraph a document never announces: a whole resume
   * pasted as one block, or a PDF whose extraction lost its blank lines.
   *
   * Splits on sentence ends *and* single newlines, because the common case here
   * is a run of bullet points that carry no terminating punctuation — on
   * sentence boundaries alone they would remain one indivisible unit.
   */
  private splitLongParagraph(
    paragraph: string,
    maxUnitTokens: number,
  ): string[] {
    const sentences = paragraph
      .split(/(?<=[.!?])\s+|\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const parts: string[] = [];
    let buffer: string[] = [];
    let bufferTokens = 0;

    for (const sentence of sentences) {
      const tokens = this.estimateTokens(sentence);

      if (bufferTokens > 0 && bufferTokens + tokens > maxUnitTokens) {
        parts.push(buffer.join(' '));
        buffer = [];
        bufferTokens = 0;
      }

      buffer.push(sentence);
      bufferTokens += tokens;
    }

    if (buffer.length > 0) {
      parts.push(buffer.join(' '));
    }

    return parts;
  }

  /**
   * The trailing units of a completed chunk, up to `overlapTokens`, to seed the
   * next one. Whole units only — an overlap that reproduced half a sentence
   * would give the embedder a fragment to represent.
   *
   * The `units.length - 1` guard is the termination condition, not a detail:
   * if the carry could take every unit, the next chunk would begin exactly
   * where this one did and the loop would never advance through the document.
   */
  private tail(units: string[], overlapTokens: number): string[] {
    if (overlapTokens <= 0) {
      return [];
    }

    const carry: string[] = [];
    let tokens = 0;

    for (let i = units.length - 1; i >= 0; i -= 1) {
      const unitTokens = this.estimateTokens(units[i]);

      if (
        tokens + unitTokens > overlapTokens ||
        carry.length === units.length - 1
      ) {
        break;
      }

      carry.unshift(units[i]);
      tokens += unitTokens;
    }

    return carry;
  }

  /**
   * Approximates tokens at ~4 characters each.
   *
   * Every consumer of this number is a budget — chunk size, context window
   * packing — where being within a few percent is enough and being wrong is
   * self-correcting. Nothing here is billed or capped on it, so the accuracy
   * does not justify shipping a tokenizer and pinning it to the provider's.
   *
   * Floors at 1 so a non-empty unit never measures as free.
   */
  estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
