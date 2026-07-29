# Career Intelligence Assistant

A fullstack RAG application (Assignment **Option 4**): upload a resume and multiple job descriptions, then ask questions about fit, skill gaps, experience alignment, and interview preparation — with every answer grounded in, and cited against, the uploaded documents.

> "What skills am I missing for this role?" · "How does my experience align with Job #2?" · "Prepare me for an interview for Job #1."

Beyond chat, each session has a **Fit Dashboard**: a structured, schema-constrained analysis of the resume against every job in the session (overall score, per-dimension scores with rationale, matched skills with evidence, gaps with severity, interview talking points).

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + Tailwind CSS 4, react-router, react-markdown |
| Backend | NestJS 11 (TypeScript, Node 22) |
| Database | PostgreSQL 16 + **pgvector** (HNSW index), Prisma 7 |
| LLM | Google Gemini (`gemini-3.6-flash` by default) |
| Embeddings | `gemini-embedding-001`, 768 dimensions, L2-normalised |
| Monorepo | pnpm workspaces (`apps/api`, `apps/web`) |

## Quick setup

Prerequisites: Node ≥ 22, pnpm 10, Docker.

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres (pgvector image, exposed on localhost:5433)
docker compose up -d

# 3. Configure the API
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env and set GEMINI_API_KEY
# (free key from https://aistudio.google.com/apikey — free tier is enough)

# 4. Create the schema and generate the Prisma client
pnpm --filter @cia/api prisma:generate
pnpm --filter @cia/api migrate:dev

# 5. Run both apps
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:3000 (health check at `GET /health` — includes a real DB round trip)

Sign in with any email (no password — see [Auth is deliberately thin](#auth-is-deliberately-thin)), upload a resume and a few job descriptions (PDF, DOCX, TXT, or Markdown — sample files live in [samples/](samples/)), create a session, and ask away.

Run the tests and linters:

```bash
pnpm test
pnpm lint
```

## Architecture overview

```mermaid
flowchart LR
    subgraph web [apps/web — React SPA]
        UI[Documents / Sessions / Chat / Fit Dashboard]
    end

    subgraph api [apps/api — NestJS]
        direction TB
        F[features/ — auth, documents, sessions, chat, fit]
        R[rag/ — ingestion & retrieval]
        A[ai/ — LLM & embeddings ports]
        F --> R --> A
    end

    UI -->|REST + x-user-email| F
    A -->|generate / embed| G[Gemini API]
    F --> P[(Postgres 16 + pgvector)]
    R --> P
```

The API is layered so that dependencies point one way: `features` (HTTP-facing use-cases) → `rag` (ingestion and retrieval logic) → `ai` (provider adapters). `LlmService` and `EmbeddingsService` are abstract ports with Gemini implementations behind them — swapping providers means writing one new adapter, not touching the RAG or feature code.

**Ingestion path:** upload → text extraction (pdf-parse / mammoth / plain text) → whitespace normalisation → paragraph-aware chunking → batched embeddings → transactional insert into pgvector. Processing is async: the document row tracks `PENDING → PROCESSING → READY | FAILED` and the UI polls the status, so a slow embed never blocks the upload request.

**Query path:** question → conversational rewrite into a standalone query → embed → cosine search (HNSW) scoped to the session's documents and the current user → relevance floor + token budget → labelled evidence blocks → grounded answer with `[n]` citations, persisted with rank and score.

## RAG / LLM approach & decisions

### Model & infrastructure choices

- **LLM — Gemini Flash.** I considered OpenAI (`gpt-4o-mini`) and Anthropic (Haiku). Gemini won on practical grounds for a take-home: a genuinely free tier that covers both chat *and* embeddings with one key and one SDK, solid structured-output support (used for the fit analysis), and quality that is more than enough for grounded Q&A where the prompt does the heavy lifting. The abstract `LlmService` port keeps this a config decision, not an architectural one.
- **Embeddings — `gemini-embedding-001` at 768 dimensions.** The model supports Matryoshka truncation; 768 dims is the sweet spot of quality vs. index size for this corpus (a handful of documents per user, not millions). Truncated vectors must be re-normalised — the adapter does this explicitly. Each chunk records which model embedded it, so a future model switch is a re-embed migration instead of a silent wipe (cosine similarity between two different models' vectors returns a number that means nothing).
- **Vector database — pgvector, not a dedicated vector store.** I considered Pinecone, Qdrant, and Chroma. Postgres already holds users, documents, sessions, and messages; putting vectors in the same database means chunk inserts are transactional with document status updates, tenant isolation is a `WHERE user_id = ...` clause on a JOIN rather than a metadata-filter convention, and there is one system to run, back up, and deploy. At this scale a dedicated store adds an operational dependency and a consistency problem while solving a performance problem I don't have. An HNSW index (`vector_cosine_ops`) keeps search fast if it grows.
- **Orchestration — none.** I considered LangChain and LlamaIndex and decided against them. The pipeline here is short and linear (rewrite → embed → search → prompt → generate), and owning those ~200 lines means every prompt, retry, and token budget is explicit and debuggable rather than buried behind a framework abstraction. Frameworks earn their keep when you need agents, tool routing, or many interchangeable backends; this project doesn't.

### Chunking

Paragraph-first with sentence-level fallback ([chunking.service.ts](apps/api/src/rag/ingestion/chunking.service.ts)): split on blank lines, pack paragraphs up to a ~300-token target with a ~60-token overlap carried between chunks, and only split inside a paragraph when it alone exceeds 1.5× the target. Resumes and job descriptions are naturally sectioned documents — bullets, headings, short paragraphs — so paragraph boundaries are the semantic boundaries, and 300 tokens keeps a chunk to roughly one resume section or one requirements block. Token counts are estimated at ~4 chars/token; for budgeting (not billing) that accuracy is sufficient and avoids shipping a tokenizer. PDF extraction output is normalised first (hard-wrapped lines, column-layout spaces, form feeds) so chunk boundaries are predictable.

### Retrieval

- **Conversational query rewrite.** Retrieval embeds the question alone, with no history attached — so "what about the second one?" embeds to noise. A cheap low-temperature LLM call first rewrites the follow-up into a standalone question; if the rewrite fails, the raw question is used rather than failing the request.
- **Scoping to named jobs.** Every job posting in a session is semantically close to every other, so "how do I fit Job #1?" would happily retrieve chunks from Job #3. When a question names `Job #N`, retrieval is narrowed to those documents plus the resume; unnamed questions stay session-wide because cross-job comparison is a legitimate ask. The rewrite prompt is instructed to preserve `Job #N` labels verbatim so this works on follow-ups too.
- **Top-K 8, relevance floor 0.35, context budget 6,000 tokens.** The floor is what enables honest "I don't know" answers; the budget keeps the prompt focused rather than stuffing everything retrieved into it.
- **Labelled evidence, persisted citations.** Each context block is numbered and labelled in the user's own vocabulary ("Job #2 — «Senior Platform Engineer»"), and every assistant message stores its citations with rank and score, so the UI can show exactly which chunk backs which claim — and so retrieval quality can be audited after the fact.

### Prompt & context management

Prompts live in one reviewable file per feature ([chat/prompts.ts](apps/api/src/features/chat/prompts.ts), [fit/fit.schema.ts](apps/api/src/features/fit/fit.schema.ts)), not scattered through service code. Chat history is windowed to the last 10 turns. The fit analysis deliberately does **not** use retrieval: it sends both full documents (truncated at 24k chars), because "score this resume against this job" needs the whole of both texts, not the nearest chunks — using RAG where it fits and skipping it where it doesn't.

### Guardrails

- **Grounding rules in the system prompt**, tuned for this domain's specific failure: a career assistant that embellishes a resume is worse than one that says "I don't know", because the user may repeat the invention in an interview. Every claim must cite evidence; the model is told to distinguish "the resume does not mention X" from "the candidate lacks X".
- **No-evidence short-circuit:** if nothing clears the relevance floor, a canned answer is returned *without calling the model at all* — no evidence means a generation could only be invention, and it costs nothing this way.
- **Low temperature** (0.2 for answers, 0.1 for scoring): creative variation reads as invented experience.
- **Schema-constrained JSON** for the fit analysis (Gemini `responseSchema`) plus a server-side validator on the parsed result — the model cannot return a malformed or out-of-range breakdown into the database.
- **Input hygiene:** global `ValidationPipe` with whitelisting, file-type and extracted-text checks (a scanned PDF with no text layer fails with an actionable message), env validation at bootstrap that names every bad variable at once.
- **Tenant isolation** enforced in SQL: every chunk search JOINs documents and filters on `user_id`; every service method resolves ownership before touching data.

### Quality & observability

- Unit tests where the logic is intricate and pure: chunking (boundaries, overlap, long-paragraph splitting) and the chunks repository (vector literal building, batched inserts, search SQL).
- Every assistant message persists **model, prompt/completion tokens, and latency** — cost and performance are queryable per message, per session, per user, and surfaced in the UI.
- Structured Nest logging at meaningful points: dropped low-score hits, query rewrites, retrieval scoping, per-document indexing time, retry attempts.
- Shared retry policy (exponential backoff on 429/5xx/network errors) for both AI clients — extracted because the same loop copy-pasted twice will drift twice. Full provider errors go to the logs; the client gets one clean sentence (provider payloads are hostile as UI copy and occasionally leak project ids).
- `GET /health` does a real `SELECT 1` — a process that answers 200 while Postgres is down is worse than no health check, because an orchestrator will route traffic to it.

## Key technical decisions

1. **Postgres as the only stateful service.** Vectors, relational data, and chat history in one transactional store. See the vector-database reasoning above; it's the single decision that most simplified everything else.
2. **Ports for AI providers.** `LlmService` / `EmbeddingsService` abstract classes with Gemini adapters. The rest of the codebase speaks in neutral terms (roles `user`/`assistant`, plain vectors); the adapter translates Gemini's quirks (e.g. its `model` role) at the edge.
3. **Async ingestion with an explicit status machine.** Upload returns immediately; embedding happens in the background with `PENDING/PROCESSING/READY/FAILED` on the row, the error message stored, and a reprocess endpoint. For this scale a fire-and-forget promise is enough — a real queue is the documented production upgrade, not a day-one need.
4. **Sessions as the unit of context.** A session pins one resume and N labelled jobs. Labels (`Job #1`, `Job #2`) are stable, stored, and flow through prompts, retrieval scoping, and citations — the whole app speaks the user's vocabulary.
5. **Fit analysis cached per (resume, job) pair** with an explicit refresh — an LLM analysis of two unchanged documents is deterministic enough to reuse and too expensive to recompute on every page load.
6. **Feature-first module layout** (`features/` vs `rag/` vs `ai/`) so the domain logic, the RAG machinery, and the provider glue can each change without rippling into the others.

### Auth is deliberately thin

Sign-in is email-only and requests carry an `x-user-email` header. This is **identification, not authentication** — it exists to demonstrate real multi-tenant data isolation (which is enforced everywhere, down to the SQL) without spending assignment time on password storage or OAuth plumbing. The guard is one class; swapping it for real JWT/OIDC auth changes no feature code. This is the first thing I'd replace for production.

## Productionizing (AWS as the example — maps 1:1 to GCP/Azure)

What exists already helps: the API is stateless (scales horizontally), config is env-driven and validated at boot, migrations are versioned, and the health check is orchestrator-grade.

**Minimum viable production:**

- **Compute:** containerise both apps (multi-stage Dockerfiles; the web app builds to static files) → API on ECS Fargate behind an ALB using `/health`, web on S3 + CloudFront. Run `prisma migrate deploy` as a release step.
- **Database:** RDS for PostgreSQL (pgvector is supported on RDS/Aurora, Cloud SQL, and Azure Flexible Server) with automated backups; PgBouncer/RDS Proxy for connection pooling under Fargate scale-out.
- **Secrets:** move `GEMINI_API_KEY`/`DATABASE_URL` to Secrets Manager, injected as env at task start.
- **Auth:** replace the header guard with Cognito/OIDC-issued JWTs (single class swap, per the design above).
- **Ingestion:** replace the in-process background promise with SQS + a worker service, and store original uploads in S3. This adds retries with dead-lettering and lets ingestion scale independently of the API.

**Then, in order of value:**

- **Observability:** OpenTelemetry traces across the request → rewrite → retrieval → generation chain, dashboards on the token/latency data already being persisted, alerting on FAILED-document rate and provider 429s.
- **Cost & abuse control:** per-user rate limits and daily token budgets (the per-message token accounting to enforce this already exists), upload size/count quotas.
- **Scale of retrieval:** the HNSW index is already in place; at real scale, tune `ef_search`, and consider partitioning chunks by user.
- **CI/CD:** GitHub Actions running lint + tests + `prisma migrate diff` on PR, image build and deploy on merge.

## Engineering standards

**Followed:**

- Strict TypeScript everywhere; DTO validation with a whitelisting global pipe; env validation at bootstrap.
- One-way layering with dependency inversion at the AI boundary; prompts as reviewed code, not string literals inline.
- Versioned SQL migrations (including hand-written parts Prisma can't express: `CREATE EXTENSION vector`, the HNSW index) with comments explaining *why* they're hand-written.
- Unit tests on the intricate pure logic; comments reserved for the *why* (the failure mode a piece of code buys out of), not the *what*.
- Conventional, reviewable commits; ESLint + Prettier (API) and oxlint (web); containerised dev database with a healthcheck.

**Consciously skipped (time-boxed, not forgotten):**

- Real authentication (see above — the seam for it is in place).
- Streaming responses (SSE) — answers arrive whole; the UI shows a thinking state.
- E2E test coverage beyond the scaffold; no frontend component tests.
- Dockerfiles for the apps themselves (only the DB is containerised for dev).
- Rate limiting and request quotas.
- A RAG evaluation harness (golden Q&A set scored for retrieval hit-rate and faithfulness).

## How I used AI tools

I used **Claude Code** as the primary assistant throughout, in a deliberately structured way:

- **I owned the architecture, the AI drafted within it.** Layering (`features`/`rag`/`ai`), the port-adapter boundary, the session/label model, and the retrieval strategy were decided first and stated explicitly in prompts; the assistant filled in implementations inside those constraints. When generated code crossed a boundary (e.g. provider details leaking above the adapter), I pushed it back rather than accepting the shortcut.
- **Working in reviewable slices.** One feature per session/commit (ingestion pipeline, then RAG chat + tenant isolation, then FE wiring, then refactors), each reviewed as a diff before committing — never "generate the whole app".
- **Refactoring passes as separate steps.** Two dedicated refactor commits (env validation + ports + shared retry; the ai/rag/features restructure) where the goal was purely to make earlier AI-assisted code match my standards, which is how I keep AI output *maintainable* rather than just *working*.
- **Do's and don'ts I follow:** do make the AI explain trade-offs before writing code; do have it write the fiddly-but-testable parts (chunking, SQL building) *with* tests; do use it for boilerplate (DTOs, wiring, Tailwind). Don't let it choose the architecture or data model unsupervised; don't accept comments that narrate the code instead of justifying it; don't trust generated claims about provider APIs without checking docs; and don't put an LLM's voice in documents that are supposed to contain my judgement — this README included: the decisions and reasoning are mine, with AI used to help check it against the codebase.

## What I'd do differently with more time

1. **Streaming answers** (SSE) — the single biggest UX improvement; latency is dominated by generation.
2. **A retrieval evaluation harness**: a golden set of questions with expected source chunks, scored on every change to chunking/prompts — right now quality regressions are caught by eye.
3. **Hybrid retrieval**: BM25/`tsvector` keyword search fused with vector search (reciprocal rank fusion). Resumes are full of exact tokens (skill names, tool versions) where lexical search beats embeddings.
4. **Real background jobs** (BullMQ or SQS) for ingestion instead of the in-process promise.
5. **Voice of the user in fit analyses**: let users annotate/dismiss gaps, feeding corrections back into interview-prep answers.
6. **OCR fallback** for scanned PDFs (currently rejected with an explanatory error).
7. **App Dockerfiles + compose profile** so the entire stack is one `docker compose up`.

## Known limitations

- No real authentication (by design, documented above).
- Documents are stored as extracted text; original files are not retained.
- Token counts for budgeting are estimates (~4 chars/token), not tokenizer-exact.
- Free-tier Gemini rate limits surface as a friendly 503 with retry guidance; there is no client-side queueing.
- English-centric prompt rules; not tested on non-English resumes.

## Screenshots

<!-- TODO: add screenshots before submission, e.g.:
![Documents page](docs/screenshots/documents.png)
![Chat with citations](docs/screenshots/chat.png)
![Fit dashboard](docs/screenshots/fit-dashboard.png)
-->

*Screenshots / demo video to be added here.*
