import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingsService,
} from '../src/ai/embeddings/embeddings.service';
import {
  LlmService,
  type GenerateJsonOptions,
} from '../src/ai/llm/llm.service';

/**
 * The full RAG loop over real HTTP and a real Postgres, with the two AI ports
 * swapped for deterministic fakes — no network, no API key, no quota. This is
 * the test the port abstraction exists to make possible: everything from
 * multer parsing through chunking, pgvector search and citation persistence
 * runs exactly as in production; only the model calls are simulated.
 */

/**
 * Word-bag embedding: each word hashes to a dimension. Texts that share words
 * get high cosine similarity, texts that share none score ~0 — which is all
 * retrieval needs to behave realistically, floor and ranking included.
 */
function fakeEmbed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);

  // Content words only (4+ chars): stop-words otherwise dilute the vectors
  // enough to drag genuinely related texts under the retrieval floor.
  for (const word of text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []) {
    let hash = 0;

    for (const char of word) {
      hash = (hash * 31 + char.charCodeAt(0)) % EMBEDDING_DIMENSIONS;
    }

    vector[hash] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;

  return vector.map((v) => v / magnitude);
}

const fakeEmbeddings: Pick<
  EmbeddingsService,
  'modelName' | 'embedDocuments' | 'embedQuery'
> = {
  modelName: 'fake-embeddings',
  embedDocuments: (texts: string[]) => Promise.resolve(texts.map(fakeEmbed)),
  embedQuery: (text: string) => Promise.resolve(fakeEmbed(text)),
};

const CANNED_ANSWER =
  'Your resume shows the Kubernetes and Terraform experience the role asks for [1].';

const CANNED_FIT = {
  overallScore: 72,
  summary: 'Solid platform fit.',
  dimensions: [
    {
      name: 'Technical skills',
      score: 80,
      rationale: 'Kubernetes, Terraform.',
    },
    { name: 'Experience level', score: 70, rationale: 'Eight years.' },
    { name: 'Domain relevance', score: 65, rationale: 'Payments background.' },
    {
      name: 'Responsibilities overlap',
      score: 72,
      rationale: 'On-call owner.',
    },
  ],
  matchedSkills: [
    { skill: 'Kubernetes', evidence: 'Eight years of Kubernetes' },
  ],
  gaps: [{ skill: 'Go', severity: 'NICE_TO_HAVE', note: 'Not mentioned.' }],
  interviewTalkingPoints: ['Walk through the observability setup.'],
};

const fakeLlm: Pick<LlmService, 'modelName' | 'generate' | 'generateJson'> = {
  modelName: 'fake-llm',
  generate: () =>
    Promise.resolve({
      text: CANNED_ANSWER,
      model: 'fake-llm',
      promptTokens: 100,
      completionTokens: 20,
      latencyMs: 1,
    }),
  generateJson: <T>(options: GenerateJsonOptions<T>) =>
    Promise.resolve({
      data: options.validate ? options.validate(CANNED_FIT) : (CANNED_FIT as T),
      model: 'fake-llm',
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 1,
    }),
};

const RESUME_TEXT =
  'Eight years of Kubernetes and Terraform experience, running production observability for payments infrastructure at scale. Led migrations, owned on-call.';

const JOB_TEXT =
  'We need a platform engineer with Kubernetes, Terraform and observability skills for our payments team. Requirements include production on-call ownership.';

describe('RAG flow (e2e, fake AI adapters)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const email = `e2e-${randomUUID()}@example.test`;
  const intruderEmail = `e2e-intruder-${randomUUID()}@example.test`;

  const agent = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmbeddingsService)
      .useValue(fakeEmbeddings)
      .overrideProvider(LlmService)
      .useValue(fakeLlm)
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts — the global pipe lives in bootstrap(), which tests skip.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Users cascade to documents, chunks, sessions, messages, citations.
    await prisma.user.deleteMany({
      where: { email: { in: [email, intruderEmail] } },
    });
    await app.close();
  });

  let resumeId: string;
  let jobId: string;
  let sessionId: string;

  const uploadAndWait = async (
    filename: string,
    content: string,
    kind: string,
  ): Promise<string> => {
    const upload = await agent()
      .post('/documents')
      .set('x-user-email', email)
      .field('kind', kind)
      .attach('file', Buffer.from(content), {
        filename,
        contentType: 'text/plain',
      })
      .expect(202);

    const id = (upload.body as { id: string }).id;

    // Ingestion is fire-and-forget; with fake embeddings it settles in
    // milliseconds, but READY still has to be observed, not assumed.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const check = await agent()
        .get(`/documents/${id}`)
        .set('x-user-email', email)
        .expect(200);

      const body = check.body as { status: string; error: string | null };

      if (body.status === 'READY') {
        return id;
      }

      if (body.status === 'FAILED') {
        throw new Error(`Ingestion failed: ${body.error ?? 'unknown'}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error('Document never became READY');
  };

  it('signs in by email alone, creating the user', async () => {
    const response = await agent()
      .post('/auth/login')
      .send({ email })
      .expect(200);

    expect((response.body as { email: string }).email).toBe(email);
  });

  it('rejects requests without the identity header', async () => {
    await agent().get('/documents').expect(401);
  });

  it('ingests a resume and a job description through the real pipeline', async () => {
    resumeId = await uploadAndWait('resume.txt', RESUME_TEXT, 'RESUME');
    jobId = await uploadAndWait('job.txt', JOB_TEXT, 'JOB_DESCRIPTION');

    const list = await agent()
      .get('/documents')
      .set('x-user-email', email)
      .expect(200);

    const body = list.body as { id: string; chunkCount: number }[];

    expect(body).toHaveLength(2);
    expect(body.every((d) => d.chunkCount > 0)).toBe(true);
  });

  it('creates a session pairing the resume with the job as Job #1', async () => {
    const response = await agent()
      .post('/sessions')
      .set('x-user-email', email)
      .send({ resumeId, jobIds: [jobId], title: 'E2E run' })
      .expect(201);

    const body = response.body as {
      id: string;
      jobs: { label: number }[];
    };

    sessionId = body.id;
    expect(body.jobs[0].label).toBe(1);
  });

  it('answers a question with citations drawn from pgvector retrieval', async () => {
    const response = await agent()
      .post(`/sessions/${sessionId}/messages`)
      .set('x-user-email', email)
      .send({
        content:
          'What Kubernetes, Terraform and observability experience do I have for payments infrastructure?',
      })
      .expect(201);

    const body = response.body as {
      role: string;
      content: string;
      citations: { label: string; score: number }[];
      model: string;
    };

    expect(body.role).toBe('ASSISTANT');
    expect(body.content).toBe(CANNED_ANSWER);
    expect(body.model).toBe('fake-llm');
    // Retrieval was real: the fake embeddings put the overlapping documents
    // above the relevance floor, and the citations record it.
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations.every((c) => c.score > 0.35)).toBe(true);
  });

  it('persists the conversation, citations included', async () => {
    const response = await agent()
      .get(`/sessions/${sessionId}/messages`)
      .set('x-user-email', email)
      .expect(200);

    const body = response.body as {
      role: string;
      citations: unknown[];
    }[];

    expect(body).toHaveLength(2);
    expect(body[0].role).toBe('USER');
    expect(body[1].role).toBe('ASSISTANT');
    expect(body[1].citations.length).toBeGreaterThan(0);
  });

  it('scores the fit through the constrained-JSON path and caches it', async () => {
    const run = await agent()
      .post(`/sessions/${sessionId}/fit`)
      .set('x-user-email', email)
      .send({})
      .expect(201);

    const body = run.body as {
      jobs: { analysis: { overallScore: number; model: string } | null }[];
    };

    expect(body.jobs[0].analysis?.overallScore).toBe(72);
    expect(body.jobs[0].analysis?.model).toBe('fake-llm');

    // Second run must serve the cache — the fake would answer, but the point
    // is that no second generation happens for an already-scored pair.
    const generateJsonSpy = jest.spyOn(fakeLlm, 'generateJson');

    await agent()
      .post(`/sessions/${sessionId}/fit`)
      .set('x-user-email', email)
      .send({})
      .expect(201);

    expect(generateJsonSpy).not.toHaveBeenCalled();
  });

  it('hides one user’s data from another end to end', async () => {
    await agent()
      .post('/auth/login')
      .send({ email: intruderEmail })
      .expect(200);

    await agent()
      .get(`/sessions/${sessionId}`)
      .set('x-user-email', intruderEmail)
      .expect(404);

    await agent()
      .get(`/documents/${resumeId}`)
      .set('x-user-email', intruderEmail)
      .expect(404);

    const list = await agent()
      .get('/documents')
      .set('x-user-email', intruderEmail)
      .expect(200);

    expect(list.body).toEqual([]);
  });
});
