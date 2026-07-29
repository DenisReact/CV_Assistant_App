import { RetrievalService } from './retrieval.service';
import type { EmbeddingsService } from 'src/ai/embeddings/embeddings.service';
import type {
  ChunksRepository,
  RetrievedChunk,
} from 'src/features/documents/chunks.repository';

describe('RetrievalService', () => {
  const hit = (overrides: Partial<RetrievedChunk>): RetrievedChunk => ({
    chunkId: 'chunk',
    documentId: 'doc',
    chunkIndex: 0,
    content: 'content',
    tokenCount: 10,
    documentTitle: 'Title',
    documentKind: 'RESUME',
    score: 0.9,
    ...overrides,
  });

  const build = (hits: RetrievedChunk[]) => {
    const embeddings = {
      embedQuery: jest.fn().mockResolvedValue([0.1, 0.2]),
    } as unknown as EmbeddingsService;

    const chunks = {
      search: jest.fn().mockResolvedValue(hits),
    } as unknown as ChunksRepository;

    return new RetrievalService(embeddings, chunks);
  };

  it('drops hits below the relevance floor instead of padding the context', async () => {
    const service = build([
      hit({ chunkId: 'a', score: 0.8 }),
      hit({ chunkId: 'b', score: 0.4 }),
      hit({ chunkId: 'c', score: 0.2 }),
    ]);

    const result = await service.retrieve({
      userId: 'u',
      query: 'q',
      minScore: 0.35,
    });

    expect(result.chunks.map((c) => c.chunkId)).toEqual(['a', 'b']);
  });

  it('returns nothing when every hit is noise — the refusal path', async () => {
    const service = build([hit({ score: 0.1 }), hit({ score: 0.05 })]);

    const result = await service.retrieve({ userId: 'u', query: 'q' });

    expect(result.chunks).toEqual([]);
    expect(result.context).toBe('');
  });

  it('skips an oversized chunk without starving the ones behind it', async () => {
    const service = build([
      hit({ chunkId: 'big', score: 0.9, tokenCount: 10_000 }),
      hit({ chunkId: 'small', score: 0.8, tokenCount: 50 }),
    ]);

    const result = await service.retrieve({
      userId: 'u',
      query: 'q',
      maxContextTokens: 100,
    });

    expect(result.chunks.map((c) => c.chunkId)).toEqual(['small']);
  });

  it('numbers surviving chunks 1..n with no gaps, so citations stay dense', async () => {
    const service = build([
      hit({ chunkId: 'a', score: 0.9 }),
      hit({ chunkId: 'drop', score: 0.1 }),
      hit({ chunkId: 'b', score: 0.8 }),
    ]);

    const result = await service.retrieve({ userId: 'u', query: 'q' });

    expect(result.chunks.map((c) => c.position)).toEqual([1, 2]);
  });

  it('labels context blocks with the session name when given, else the kind', async () => {
    const service = build([
      hit({
        chunkId: 'a',
        documentId: 'job-1',
        documentKind: 'JOB_DESCRIPTION',
      }),
    ]);

    const labelled = await service.retrieve({
      userId: 'u',
      query: 'q',
      labels: new Map([['job-1', 'Job #2']]),
    });
    const unlabelled = await service.retrieve({ userId: 'u', query: 'q' });

    expect(labelled.context).toContain('[1] Job #2');
    expect(unlabelled.context).toContain('[1] Job description');
  });
});
