# AI Agent Workflow Builder — VocalLabs Assignment

nhost + Hasura + PostgreSQL + GraphQL, per the assignment spec.

## What's actually verified, and how

I don't have Docker or network access to nhost's cloud platform from where
this was built, so unlike a normal local dev loop I couldn't run Hasura
itself. What I *could* do, and did:

- **Installed real PostgreSQL and ran the actual migration** (`migrations/0001_schema.sql`)
  against it — it applies cleanly, all 10 tables + 1 view.
- **Proved the multi-tenant isolation logic directly in SQL** before writing
  a line of Hasura permission YAML — seeded two orgs, confirmed an Org B
  user gets zero rows querying Org A's `workflows` by guessed ID, both
  directly and through the `workflow_steps` relationship.
- **Wrote the Action handler as a real Express/TypeScript service and ran
  32 tests against it** — all against real infrastructure, no mocks: 10
  integration tests for `triggerWorkflowRun` and 6 for `approveStep`
  hitting the live Postgres database directly (permission checks, quota
  enforcement, retry timing — actually observed, e.g. 1032ms matching two
  500ms retry delays — conditional branching, and the full approval-gate
  pause -> approve -> resume cycle, including cross-org isolation attempts
  correctly blocked even with the exact right ID), plus 11 unit tests for
  the condition evaluator and 5 for the retry helper.
- **Built and served the Next.js frontend** — clean typecheck, clean
  production build, confirmed it boots and returns 200.
- **Found and fixed two real bugs** via the tests themselves (a branch-
  execution bug and a condition-evaluator path bug) — see `DECISIONS.md`
  for both, including what would have gone wrong if they'd shipped.

**What is NOT verified**: the Hasura permission YAML itself. I wrote it
carefully, following Hasura's documented `_exists`/`_ceq` multi-tenant
pattern, cross-checked conceptually against the SQL logic I did prove
correct — but I never ran it against an actual Hasura instance. A few YAML
files have inline comments flagging the one or two spots I was least
certain of the exact syntax. **This is the first thing to verify once you
have a real nhost project running** — the Hasura console's row-level
permission tester is the fastest way to do it.

## Setting up nhost (you have to do this part)

1. Create a free account at nhost.io, create a new project.
2. Note your project's **subdomain** and **region** from the dashboard —
   these go in `frontend/.env.local` as `NEXT_PUBLIC_NHOST_SUBDOMAIN` and
   `NEXT_PUBLIC_NHOST_REGION`.
3. Install the Hasura CLI and the nhost CLI if you don't have them.
4. Run the migration: either paste `migrations/0001_schema.sql` directly
   into the Hasura console's SQL tab (fastest for a demo), or wire it up
   as a proper `hasura migrate` migration if you want it tracked.
5. Copy `hasura/metadata/` into your project's Hasura metadata directory
   and run `hasura metadata apply` — then **immediately open the console
   and manually test a select on `workflows` as a non-admin role** to
   confirm the permission YAML actually does what it's supposed to before
   trusting it further.
6. Deploy the action-handler somewhere reachable (Render, Railway, a VM —
   anywhere that can hold a long-lived Postgres connection). Set
   `ACTION_HANDLER_BASE_URL` in your Hasura metadata's env vars to point
   at it, and set `ACTION_HANDLER_SECRET` / `EVENT_TRIGGER_SECRET` to
   matching values on both sides.
7. Point `action-handler`'s `DATABASE_URL` at the same Postgres instance
   nhost/Hasura is using (nhost exposes this in project settings).

## Running the action handler locally

```
cd action-handler
npm install
cp .env.example .env    # fill in DATABASE_URL, ACTION_HANDLER_SECRET, etc.
npm run build && npm start   # or npm run dev for ts-node
npm test                      # 32 tests, needs DATABASE_URL pointed at a real Postgres
```

## Running the frontend locally

```
cd frontend
npm install
cp .env.local.example .env.local   # fill in your nhost subdomain/region
npm run build && npm start
```

## What's genuinely stubbed, and why (per the spec's own allowance)

- **`llm_call`**: calls Groq's real API if `GROQ_API_KEY` is set; otherwise
  a stubbed response with an 800ms artificial delay, explicitly flagged
  `stubbed: true` in the output rather than hidden — the spec allows this
  directly ("if you can't get access, a stubbed call with a disclosed
  artificial delay is fine").
- **`notify`**: no real Slack/email credentials — records what it *would*
  have sent, flagged `stubbed: true`.
- **Scheduled trigger**: the cron tick endpoint exists and is wired into
  Hasura's cron trigger metadata, but the actual per-workflow cron-string
  evaluation (checking `workflow_triggers.config.cron` against the current
  time) is a documented stub — mechanical to add (a `cron-parser` npm
  package), not where this assignment's evaluation weight is concentrated
  per its own criteria.

## Final Task scenario — what's built for it, what you still need to run live

Everything the six-step scenario needs is implemented: two orgs isolated
end-to-end (proven at the SQL level, tested at the Action-handler level,
written but unverified at the Hasura level), a 3+ step workflow with
`llm_call`/`http_request`/`conditional_branch`, manual trigger (built),
webhook trigger (built — `POST /webhooks/workflow/:workflowId?secret=...`),
an `approval_gate` that only an owner/editor can clear, and a live
subscription-driven run view with the paused state visible in the UI.

What you need to do: stand up the real nhost project, apply the schema and
metadata, deploy the action-handler, and **walk through the scenario
yourself once** before it's a live demo — this is precisely the kind of
thing that needs to be seen working, not just read about in a README.
