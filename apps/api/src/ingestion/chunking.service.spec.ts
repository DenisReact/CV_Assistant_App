import { ChunkingService } from './chunking.service';

describe('ChunkingService', () => {
  const service = new ChunkingService();

  const paragraph = (words: number, word = 'engineering'): string =>
    Array.from({ length: words }, () => word).join(' ');

  it('returns nothing for empty or whitespace-only input', () => {
    expect(service.chunk('')).toEqual([]);
    expect(service.chunk('   \n\n  \n ')).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const chunks = service.chunk(
      'Senior engineer with eight years of Node.js.',
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].content).toContain('Senior engineer');
  });

  it('numbers chunks sequentially from zero', () => {
    const text = Array.from(
      { length: 12 },
      (_, i) => `Section ${i}. ${paragraph(60)}`,
    ).join('\n\n');

    const chunks = service.chunk(text, {
      targetTokens: 100,
      overlapTokens: 20,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_, index) => index),
    );
  });

  it('splits a paragraph that is too long to keep whole', () => {
    // One paragraph, no blank lines to split on — only the sentence fallback can
    // break this up.
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} about distributed systems work.`,
    ).join(' ');

    const chunks = service.chunk(sentences, {
      targetTokens: 80,
      overlapTokens: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('carries the trailing unit of a chunk into the next one', () => {
    const text = [
      'Alpha paragraph about Kubernetes.',
      'Beta paragraph about Terraform.',
      'Gamma paragraph about observability.',
      'Delta paragraph about incident response.',
    ].join('\n\n');

    // Target large enough to hold several paragraphs, so there is a trailing
    // unit available to carry. A split mid-thought loses the context that made
    // it retrievable, which is what the overlap is for.
    const chunks = service.chunk(text, { targetTokens: 30, overlapTokens: 12 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].content).toContain('Gamma paragraph');
    expect(chunks[1].content).toContain('Gamma paragraph');
    expect(chunks[1].content).toContain('Delta paragraph');
  });

  it('never makes a chunk a strict subset of the next one', () => {
    // `tail` always leaves at least one unit behind. Without that, an overlap
    // budget at or above the target size would carry the whole chunk forward and
    // every chunk would contain all its predecessors.
    const text = Array.from(
      { length: 8 },
      (_, i) => `Paragraph ${i} about platform work.`,
    ).join('\n\n');

    const chunks = service.chunk(text, {
      targetTokens: 20,
      overlapTokens: 100,
    });

    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].content).not.toContain(chunks[i - 1].content);
    }
  });

  it('terminates on a document made entirely of oversized units', () => {
    // Regression guard: if the overlap carry ever returns every unit it was
    // given, the packing loop makes no progress and never returns.
    const text = Array.from({ length: 5 }, () => paragraph(400)).join('\n\n');

    const chunks = service.chunk(text, { targetTokens: 50, overlapTokens: 49 });

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('never emits an empty chunk', () => {
    const text = 'One.\n\n\n\nTwo.\n\n   \n\nThree.';

    for (const chunk of service.chunk(text, { targetTokens: 5 })) {
      expect(chunk.content.trim()).not.toBe('');
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('estimates at least one token for any non-empty text', () => {
    expect(service.estimateTokens('a')).toBe(1);
    expect(service.estimateTokens('a'.repeat(400))).toBe(100);
  });
});
