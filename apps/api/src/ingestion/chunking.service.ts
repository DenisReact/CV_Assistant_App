import { Injectable } from '@nestjs/common';

export interface TextChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

const DEFAULT_TARGET_TOKENS = 300;

const DEFAULT_OVERLAP_TOKENS = 60;

const HARD_SPLIT_MULTIPLIER = 1.5;

@Injectable()
export class ChunkingService {
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

  estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
