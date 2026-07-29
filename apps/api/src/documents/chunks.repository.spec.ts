import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ChunksRepository } from './chunks.repository';
import { EMBEDDING_DIMENSIONS } from '../embeddings/embeddings.service';
import { DocumentKind, DocumentStatus } from '../generated/prisma/enums';

describe('ChunksRepository', () => {
  let prisma: PrismaService;
  let repository: ChunksRepository;

  const userIds: string[] = [];

  const unitVector = (axis: number): number[] =>
    Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
      i === axis ? 1 : 0,
    );

  const seedUser = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });

    userIds.push(user.id);

    return user.id;
  };

  const seedDocument = async (
    userId: string,
    title: string,
  ): Promise<string> => {
    const document = await prisma.document.create({
      data: {
        userId,
        kind: DocumentKind.RESUME,
        title,
        rawText: 'seed',
        status: DocumentStatus.READY,
      },
    });

    return document.id;
  };

  beforeAll(() => {
    const config = new ConfigService({
      DATABASE_URL: process.env.DATABASE_URL,
    });

    prisma = new PrismaService(config);
    repository = new ChunksRepository(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("never returns another user's chunks, even on an exact vector match", async () => {
    const [alice, bob] = [await seedUser(), await seedUser()];

    const aliceDoc = await seedDocument(alice, 'Alice resume');
    const bobDoc = await seedDocument(bob, 'Bob resume');

    const bobVector = unitVector(1);

    await repository.replaceForDocument(
      aliceDoc,
      [
        {
          chunkIndex: 0,
          content: 'Alice: eight years of Node.js',
          tokenCount: 7,
          embedding: unitVector(0),
        },
      ],
      'test-model',
    );

    await repository.replaceForDocument(
      bobDoc,
      [
        {
          chunkIndex: 0,
          content: 'Bob: confidential salary history',
          tokenCount: 6,
          embedding: bobVector,
        },
      ],
      'test-model',
    );

    const results = await repository.search({
      userId: alice,
      embedding: bobVector,
      limit: 10,
    });

    expect(results.map((row) => row.documentId)).not.toContain(bobDoc);
    expect(results.every((row) => row.documentId === aliceDoc)).toBe(true);
  });

  it('ranks an exact match above an orthogonal one and scores it 1', async () => {
    const userId = await seedUser();
    const documentId = await seedDocument(userId, 'Ranking');

    await repository.replaceForDocument(
      documentId,
      [
        {
          chunkIndex: 0,
          content: 'axis zero',
          tokenCount: 2,
          embedding: unitVector(0),
        },
        {
          chunkIndex: 1,
          content: 'axis one',
          tokenCount: 2,
          embedding: unitVector(1),
        },
      ],
      'test-model',
    );

    const results = await repository.search({
      userId,
      embedding: unitVector(1),
      limit: 2,
    });

    expect(results[0].content).toBe('axis one');
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[1].score).toBeCloseTo(0, 5);
  });

  it('restricts results to the requested documents', async () => {
    const userId = await seedUser();
    const [included, excluded] = [
      await seedDocument(userId, 'In scope'),
      await seedDocument(userId, 'Out of scope'),
    ];

    for (const documentId of [included, excluded]) {
      await repository.replaceForDocument(
        documentId,
        [
          {
            chunkIndex: 0,
            content: 'same',
            tokenCount: 1,
            embedding: unitVector(0),
          },
        ],
        'test-model',
      );
    }

    const results = await repository.search({
      userId,
      embedding: unitVector(0),
      limit: 10,
      documentIds: [included],
    });

    expect(results).toHaveLength(1);
    expect(results[0].documentId).toBe(included);
  });

  it('replaces chunks rather than accumulating them, and drops the orphaned tail', async () => {
    const userId = await seedUser();
    const documentId = await seedDocument(userId, 'Reprocessed');

    await repository.replaceForDocument(
      documentId,
      [0, 1, 2].map((chunkIndex) => ({
        chunkIndex,
        content: `first pass ${chunkIndex}`,
        tokenCount: 3,
        embedding: unitVector(chunkIndex),
      })),
      'test-model',
    );

    await repository.replaceForDocument(
      documentId,
      [
        {
          chunkIndex: 0,
          content: 'second pass',
          tokenCount: 2,
          embedding: unitVector(0),
        },
      ],
      'test-model',
    );

    const count = await prisma.chunk.count({ where: { documentId } });

    expect(count).toBe(1);
  });

  it('rejects a vector of the wrong width before touching the database', async () => {
    const userId = await seedUser();
    const documentId = await seedDocument(userId, 'Bad width');

    await expect(
      repository.replaceForDocument(
        documentId,
        [{ chunkIndex: 0, content: 'x', tokenCount: 1, embedding: [1, 2, 3] }],
        'test-model',
      ),
    ).rejects.toThrow(/expected 768/);

    expect(await prisma.chunk.count({ where: { documentId } })).toBe(0);
  });
});
