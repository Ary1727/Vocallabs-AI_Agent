# Decisions

## Schema reasoning

`org_members` is the single source of truth for every permission check in
this system — both the Hasura row-level filters (`hasura/metadata/`) and
the Action handler's own independent checks (`permissions.ts`) trace back
to a row existing there. Every other table either has a direct `org_id`
(organizations, workflows, watched_events, and — denormalized on purpose —
workflow_runs) or reaches it through exactly one relationship hop
(workflow_steps, workflow_triggers, step_runs). Denormalizing `org_id`
onto `workflow_runs` instead of forcing every query to join through
`workflows` was a deliberate tradeoff: it keeps the Hasura permission
filter for `workflow_runs` a single `_exists` clause instead of a
two-relationship traversal, at the cost of one redundant column that has
to stay in sync (it's written once at creation time in `db.ts` and never
updated, so there's no actual sync risk in practice).

`workflow_results` exists because `db_write` needs somewhere real to
write — the spec says "saves a result into your own tables" without
specifying what, so a generic org-scoped JSONB table was the least
presumptuous choice rather than inventing a business domain.
`watched_events` exists for the same reason on the trigger side: rather
than dynamically creating a Hasura Event Trigger per user-defined
"watched table" (real complexity outside this assignment's scope),
external events land in one table and a single Event Trigger dispatches
from there — documented in the migration and in
`hasura/metadata/databases/default/tables/public_watched_events.yaml`.

## How the two permission layers are enforced differently

**Layer 1 (org + role scoping)** lives entirely in Hasura's row-level
permission YAML, via the `_exists`/`_ceq` pattern against `org_members`
(see any table's `select_permissions` for the shape). This is genuinely a
database-level guarantee — Hasura rewrites every query to include the
filter, so there's no code path that can accidentally skip it. I proved
the *query logic* this YAML encodes is correct by running the equivalent
raw SQL against a real seeded two-org Postgres database before writing a
single line of YAML (see the seed/query transcript from development) —
Org B got zero rows both querying `workflows` directly by guessed ID and
through the `workflow_steps` relationship. I could not run the YAML
itself against live Hasura from where I built this, so that translation
step — SQL logic I verified, into Hasura's permission DSL — is the one
piece of this submission that still needs to be confirmed against a real
Hasura console before the live demo, and several of the YAML files say so
explicitly at the point I was least certain of the exact syntax.

**Layer 2 (step-level gating)** is split across two different
mechanisms depending on *when* the decision needs to happen:

- For `db_write`/`notify` steps and `webhook` triggers — decisions that
  can be fully resolved at write time — it's still a Hasura permission,
  just a second, separate one: `workflow_steps` and `workflow_triggers`
  each have distinct `insert_permissions` for `owner` (any type allowed)
  vs. `editor` (everything except the restricted types), rather than one
  rule with a conditional inside it, because Hasura permissions are
  inherently per-role.
- For the approval gate specifically, this can't be a database permission
  at all, and the spec says so directly: "clearing an approval_gate...
  can't be a database permission alone, since it's a mid-execution
  decision, not a simple row read or write." A Hasura permission can gate
  *can this user update this row*, but "resume a paused workflow, which
  then executes further steps with real external side effects" is a
  business operation, not a column write. That check lives in
  `approveStep.ts`, calling the same `requireOrgRole()` the trigger path
  uses — and it's checked *again* independently of whatever Hasura's
  Action-level `permissions:` list already filtered, for the reason
  documented in `permissions.ts`: the handler is a separately deployed
  HTTP service reachable on its own URL, so it cannot assume Hasura is
  the only thing that will ever call it.

## How the approval-gate pause/resume is implemented

`executeStepsInOrder()` (`runWorkflow.ts`) is one function used by both
the initial trigger and the resume path — `triggerWorkflowRun` calls it
starting from the first step; `approveStep` calls the *same* function
starting from the step after the approved gate. Hitting an
`approval_gate` step returns a `'paused'` result immediately, without
executing anything further; `step_runs.status` is set to `paused` and
`workflow_runs.status` is set to `paused`, and the function returns.
`approveStep` re-verifies the approver's role, checks the step_run is
actually still `paused` (not already resolved — this is what makes
double-approval a `409`, not a silent no-op), records `approved_by`/
`approved_at`, flips the run back to `running`, and re-enters
`executeStepsInOrder` from the next step by `step_order`.

## Addendum: what live deployment against real infrastructure surfaced

Everything above this line was written and tested locally, or against my own
mock server. This section documents what changed once the app was deployed
to real, permanent infrastructure (Render for the action-handler, Vercel
for the frontend) and exercised through the actual browser UI rather than
GraphiQL with manually-set headers. Several real, distinct bugs surfaced —
each is listed with root cause and fix, not glossed over.

### Bug 1: nhost's default JWT role vs. custom app roles were never connected

nhost's Auth system issues its own JWT with `x-hasura-default-role` set to
a generic `user` role for every signed-up account — completely independent
of this app's `org_role` enum (`owner`/`editor`/`viewer`) and the
`org_members` table that's supposed to be the source of truth for
permissions. Every Hasura permission filter in this project checks
`X-Hasura-User-Id` against `org_members`, but Hasura never even attempts
those filters unless the caller's *role* is one it recognizes — and
`user` was never granted any permissions at all.

**Fix:** nhost/Hasura's Auth schema includes `auth.roles` and
`auth.user_roles` tables, plus a `default_role` column on `auth.users`,
specifically for mapping real users to custom app-level roles. Registering
the three roles there and setting a user's `default_role` to `owner`
correctly changes what the issued JWT claims — confirmed by decoding the
token directly (`x-hasura-default-role":"owner"` after the fix, `"user"`
before).

**Known limitation this leaves:** `default_role` is one static role per
user, not scoped per-organization. A user who is `owner` in one org and
`viewer` in another would need the frontend to explicitly override the
role per-request (Hasura supports this via an `x-hasura-role` header the
client can set, chosen from the token's `allowed_roles` list) — the
current frontend doesn't do this, since the demo scenario only needed one
role per user. This is a real product gap, not something I'd claim was
handled.

### Bug 2: `workflows`' downward relationships were never tracked

`organization` (workflow → its parent org) was tracked, but the reverse
relationships — `workflow_steps`, `workflow_triggers`, `workflow_runs`
(workflow → its children) — were left as Hasura's "suggested, untracked"
state. A table having a select permission does not make its relationships
to other tables automatically traversable in GraphQL; each relationship
has to be explicitly tracked. This silently broke the main workflow list
query, which nests all three in one request.

### Bug 3: incomplete column allow-lists on nearly every permission

This was the single most common failure mode today, surfacing repeatedly
across `organizations`, `org_members`, `workflows`, `workflow_steps`,
`workflow_triggers`, `workflow_runs`, and `step_runs`. Two distinct
column-permission scopes exist per table and were inconsistently
configured:

- **Select column permissions** control both what a query can filter on
  (`where: { user_id: ... }` fails with "field not found" if `user_id`
  isn't in the select allow-list, even though it's a perfectly real
  column) and what an insert mutation is allowed to *return* (`insert_...
  { id }` fails the same way if `id` isn't select-permitted, even when
  it's correctly insert-permitted).
- **Insert column permissions** separately control what fields a mutation
  is allowed to *write*.

Getting a table fully working required both to have every relevant column
checked, not just one. This was diagnosed by decoding each error's target
type name — `_insert_input` errors meant "check insert columns,"
unqualified type names (`workflow_steps`, `step_runs`) meant "check select
columns" — and fixed table by table until the live app worked end to end.

### Bug 4: GraphQL enum type mismatch in the frontend

`workflow_steps.type` and `workflow_triggers.type` are Postgres enums
(`step_type`, `trigger_type`), but `lib/graphql.ts`'s mutations declared
their GraphQL variables as plain `String!`. Hasura correctly rejected this
as a type mismatch once the mutation actually reached it (this was masked
earlier by the column-permission bugs above, which failed before type
checking even ran). Fixed by declaring the variables with the correct
enum types; verified with a clean typecheck and a successful production
build before redeploying.

### What this proves, cumulatively

Every one of these bugs was found by actually running the app against
real infrastructure and reading the actual error Hasura returned — not by
guessing, and not by assuming the first version that compiled was correct.
The end state, verified live through the deployed frontend at
`https://vocallabs-ai-agent.vercel.app`, not just GraphiQL:

- Real login → correctly-scoped JWT → org-filtered workflow list
- A workflow built through the UI (name, steps of multiple types, trigger)
  saves correctly
- A run's live status streams over a GraphQL subscription with no
  page refresh, showing each step's real output as it completes
- The approval-gate pause/resume cycle, cross-org isolation block, and
  quota enforcement were all independently re-verified via direct
  `psql` queries against the same production database the app uses —
  not just trusting API responses.
