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

## Two real bugs this caught, found by actually running the tests against real Postgres

1. **Branch execution bug**: an early version of `executeStepsInOrder`
   fell through to `step_order + 1` after executing a `conditional_branch`
   target step — which, when both branch targets happened to sit at
   adjacent step_orders (as in the integration test), meant the workflow
   silently executed *both* sides of the conditional instead of the one
   the condition selected. Fixed by tracking whether the current step was
   reached via a branch redirect and treating branch targets as terminal
   rather than falling through — a real, disclosed scope decision (this
   model doesn't support merging control flow back after a branch), not
   an accident.
2. **Condition evaluator path bug**: `resolvePath`'s special-casing of
   `.length` for arrays/strings broke the more common case of a plain
   object with a field literally named `length` (e.g. `{ length: 150 }`
   as a data field) — caught by the evaluator's own first test case.
   Both are described in more detail in code comments at their fix sites.
