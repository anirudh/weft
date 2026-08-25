# Weft project briefing

This file is the durable orientation for agents working in this repository. Read it
before planning a change, then verify any change-sensitive detail against the live
code and `git status`. The worktree may contain unrelated in-progress work; preserve
it and stage explicit paths only.

## What Weft is trying to become

Weft makes an inbox useful rather than merely sorted. Email contains obligations,
commitments, money, and things the reader is waiting for, but chronological inboxes
bury those facts. Weft should continuously turn mail into living, explainable views
of what matters now.

The README's north star is a local, free, open-source app where a person can describe
what matters in plain English. A view would combine a cheap deterministic gate with
a semantic model predicate, show why mail matched, maintain a summary, and expose
tasks and deadlines. The intended posture is: your email, your model, your rules.

This is not an inbox-zero product. It should not make users process every message or
reward an empty inbox. It should surface the few facts and decisions that change what
the reader should do.

## Reality check: north star versus current code

The README's `Status` section and parts of `How it works` are behind the code. As of
2026-08-25, the repository is beyond scaffolding and contains a working vertical
slice, but it has not yet implemented the full README vision.

Implemented now:

- A local Fastify process, local SQLite database, and React/Vite web UI.
- Read-only Gmail OAuth, multi-mailbox backfill, local message/thread storage, and
  reconnect state.
- An auditable deterministic bulk-mail pass followed by per-thread model extraction.
- The `Horizon` front page: an AI-written state brief, open loops split into "Your
  court" and "Their court", a seven-day commitment view plus later events, and mail
  ordered by the relevance of its thread.
- Local, reversible completion and dismissal of obligations.
- A subscriptions lens that groups renewal obligations by service, normalises costs
  to a monthly total, distinguishes stated dates from projections, and records
  reversible `kept`/`cancelled` decisions.
- A frozen, anonymised extraction eval corpus plus deterministic unit tests.

Not implemented yet, despite the README vision:

- User-authored plain-English filters/views and compilation into editable gates.
- Writing labels or any other state back to Gmail. The current OAuth scope is
  deliberately `gmail.readonly`; Weft cannot label, send, archive, or delete mail.
- Continuous/incremental Gmail watching. `historyId` is stored, but the live sync
  path is an explicit backfill.
- A generic bring-your-own-model abstraction. The current implementation calls
  Gemini on Vertex AI through Google application-default credentials.
- A UI for the full ingest -> bulk -> extract operational pipeline; several stages
  are currently triggered through API endpoints.

When discussing product status, say which side of this boundary a claim belongs to.
Do not silently treat README aspirations as shipped behavior, and do not erase the
north star merely because the first vertical slice is narrower.

## Product and safety invariants

These choices are deliberate and should survive refactors unless the user explicitly
changes the product direction.

1. **Read-only means read-only.** User actions update the local database, not Gmail.
   Copy and UI must never imply that "Cancelled", "Completed", or "Dismissed" changed
   the outside world.
2. **The model proposes; code verifies and organises.** Models extract semantics and
   compose prose. Deterministic code filters obvious bulk mail, validates claimed date
   anchors, suppresses already-settled auto-pay bills, resolves recurring money,
   ranks, buckets, deduplicates, and records decisions.
3. **Never manufacture certainty.** A model-supplied date is retained only when its
   literal `anchorQuote` contains a date expression. Unknown prices stay unknown.
   Projected renewals are labelled estimated. A missing fact is safer than a confident
   fiction.
4. **Hiding real work is the expensive mistake.** Deduplication is conservative and
   render-time only; source obligations remain intact. Bulk decisions retain reasons.
   Ambiguous undated items decay rather than receiving invented urgency.
5. **Use calm, forward-facing language.** The product says "Do today", "Still open?",
   and "Worth chasing", never "late", "failed", or "overdue". Urgency is carried by
   ordering and wording, not alarm colours or motivational theatre. The rules live
   in `voice.md`, which is loaded into the prompts rather than described by them,
   and its mechanical half is a test. This governs every user-facing string,
   including the ones written in code: the reader cannot tell which words a model
   wrote.
6. **User decisions are distinct and reversible.** Completing means it happened;
   dismissing means it will not happen. Keeping a subscription still counts its cost;
   cancelling removes it from the running total but preserves an undoable record.
7. **Do not block ordinary UI actions on model latency.** Backfills and extraction
   start in the background. Edition composition is hash-cached and stale-while-
   revalidate so a two-millisecond local action never waits seconds for prose.
8. **Privacy is part of correctness.** Mail, OAuth tokens, capture maps, and local
   identity patterns are gitignored. Eval fixtures must be scrubbed and should use
   structure rather than sensitive subject matter. Never print or commit mailbox
   contents casually.

## The current product model

### Horizon and lenses

`Horizon` is the front page: what needs the reader today, across subjects. A lens is a
standing question over the same mail with its own unit and reading cadence. The first
lens is Subscriptions: "what am I paying for?" A lens earns a stable surface when the
front-page decay/ranking model would otherwise hide the answer.

### Obligations

An obligation belongs to one court:

- `yours`: the reader owes the next move.
- `theirs`: the reader asked a specific person or organisation for something and is
  still waiting. This should remain relatively rare.

Its temporal class determines how relevance changes with time:

- `deadline`: climbs toward its date, gets a short grace period, then recedes.
- `event`: matters around its date and recedes after it passes.
- `window`: remains open until its closing date, then falls away.
- `waiting_on`: becomes more relevant as silence continues, but never outranks a due
  item in the reader's court.
- `reference`: findable but never surfaced on Horizon.
- `ambient`: decays on a short half-life and does not become an open loop.

Events are commitments, not tasks. They belong in This Week/Later, not in the open
loop list. Distant recurring charges belong in the subscriptions lens; only imminent,
undecided renewals may remain on Horizon.

### Recurring commitments

The subscriptions lens is defined by structured `service` plus `cadence`, not by
keyword matching. Its unit is a service, while Horizon's unit is an obligation/email.
Rows about the same service collapse via a normalised service key. Evidence precedence
matters: a stated date beats a projected one, and unknown prices are excluded from the
total but never hidden.

Obligation completion/dismissal must not remove a service from the subscription
ledger. A subscription outlives any one renewal email; only `subscription_state`
controls whether it is active, kept, or cancelled.

## Architecture and data flow

This is an npm-workspaces TypeScript monorepo requiring Node 22 or newer.

- `apps/server`: Fastify API, SQLite/Drizzle persistence, Gmail/Google OAuth, Vertex
  client, ingest/extraction/ranking pipeline, eval harness, and production static-file
  serving.
- `apps/web`: React/Vite UI. In development Vite proxies `/api` to Fastify; in a
  production build Fastify serves `apps/web/dist`, preserving the one-process goal.
- `packages/shared`: Zod schemas and TypeScript types shared across server and web.
  Treat it as the product vocabulary and change it before or alongside both consumers.
- `apps/server/migrations`: ordered, hand-written SQLite migrations. Startup applies
  each unseen `.sql` file transactionally and records it in `_migrations`.

The current pipeline is:

1. OAuth stores one account row per mailbox, including its refresh token locally.
2. Backfill lists recent Gmail messages, fetches full MIME bodies with bounded
   concurrency, normalises them, hashes content, and stores them idempotently.
3. Messages are grouped into threads, which are the extraction unit.
4. The deterministic bulk pass exempts sent/replied threads, drops explainable bulk
   shapes, and records the reason. It deliberately leaves Gmail Updates/Personal mail
   for semantic inspection because transactional mail shares marketing headers.
5. The extractor sends a capped head-and-tail representation of each non-bulk thread
   to Vertex and validates the result with the shared Zod contract.
6. Code validates dates, removes explicitly auto-settled payments, and completes
   recurring fields from prose without inventing values.
7. Horizon computes relevance from class/date/time, performs conservative render-time
   deduplication, builds calendar and mail projections, and requests a cached edition.
8. The React UI applies immediate optimistic visual state, then refetches the
   server-authoritative projection.

Important tables in `apps/server/src/db/schema.ts` are `accounts`, `messages`,
`threads`, `obligations`, `subscription_state`, `editions`, and `sync_runs`. All
mail-derived rows are account-scoped from the first migration.

## High-value code paths

- Server assembly and one-process serving: `apps/server/src/index.ts`
- Shared contracts: `packages/shared/src/index.ts`
- OAuth and Gmail reads: `apps/server/src/google/oauth.ts`, `google/gmail.ts`
- Backfill/thread materialisation: `apps/server/src/pipeline/ingest.ts`
- Deterministic bulk gate: `pipeline/bulk.ts`, `pipeline/bulk-run.ts`
- Extraction prompt and persistence: `pipeline/extract.ts`
- Code-side truth checks: `pipeline/anchor.ts`, `pipeline/settled.ts`,
  `pipeline/recurring.ts`
- Pure time model and deduplication: `pipeline/rank.ts`, `pipeline/dedupe.ts`
- Non-blocking edition cache: `pipeline/compose.ts`
- Server projections: `routes/horizon.ts`, `routes/subscriptions.ts`
- UI shell and views: `apps/web/src/App.tsx`, `Horizon.tsx`, `Subscriptions.tsx`
- Model regression corpus: `apps/server/src/eval/README.md`, `eval/run.ts`, and
  `eval/fixtures/`
- Product voice: `voice.md` at the repo root, loaded by `pipeline/voice.ts` and
  enforced by `packages/shared/src/voice-lint.ts`. The brief corpus that measures
  a voice change is `eval/brief-cases.ts` and `eval/brief-run.ts`.

## Working in this repository

Typical commands:

```sh
npm run dev
npm run build
npm run test
npm run typecheck --workspaces --if-present
npm run eval
```

Notes:

- Copy `.env.example` to a local `.env` and keep it untracked. Environment validation
  happens during module import, so even tests that import server modules need the
  required settings.
- `npm run test` includes live Vertex contract tests and therefore needs valid Google
  application-default credentials and network access. Pure pipeline tests can be run
  separately when live-model access is not intended.
- `npm run eval` calls the configured extraction model and has real token/cost and
  nondeterminism. Use multiple repetitions for prompt comparisons, not a single run.
- Before committing, configure `git config core.hooksPath .githooks`. The hook scans
  staged additions for generic secrets, payment-shaped numbers, and optional local
  patterns in the gitignored `data/secret-patterns.txt`.

For a normal implementation change:

1. Inspect `git status` and the live call path first. Preserve unrelated work.
2. Update shared contracts, migrations, server behavior, and UI together when a data
   shape crosses those boundaries.
3. Put deterministic decisions in pure functions and add focused adversarial tests.
4. If extraction behavior or prompt wording changes, read `apps/server/src/eval/README.md`
   in full, run the relevant fixtures, then run repeated corpus comparisons before
   accepting the change.
5. Build/typecheck both workspaces and run tests proportionate to the change.
6. Stage explicit paths and inspect the cached diff before committing.

## Sharp edges worth preserving

- Parse `YYYY-MM-DD` as a local calendar date, not with `new Date(iso)`, which treats
  it as UTC and shifts the visible day west of Greenwich.
- The extraction prompt is intentionally long and specific. A simpler rewrite was
  measured and regressed the corpus. In particular, the apparently contradictory
  camp-evaluation few-shot example is load-bearing; do not "fix" it without repeated
  before/after eval evidence.
- A subject line is not evidence. "Action required" and firm dates are common in
  marketing. The consequence or booked commitment must come from the body/thread.
- Do not make broad header-based bulk rules for Gmail Updates or Personal. Real school,
  receipt, and transactional messages use the same no-reply/list headers as marketing.
- Deduplicate after extraction and before view slicing. Never delete source obligations
  merely because two render rows look alike.
- Keep composition failure isolated. A failed AI-written brief must not take down the
  deterministic page beneath it.
- Never equate "kept" with "cancelled": both settle a decision, but only cancellation
  stops the cost from counting.
