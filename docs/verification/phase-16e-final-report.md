# Phase 16E — Final Report

**Status** Closed · **Date** 2026-08-21 · **Commit** `2e70fa4` · **Branch**
`claude/phase-5-employment-workforce-xaxasu` · **Working tree** clean

**Phase 16E is COMPLETE on the Munaxa Work side.** No Work-owned requirement remains.

**Scheduled reminders are not operational**, and this report does not claim they are. Every part of
the capability is built, verified and merged in this repository, and **nothing invokes it**, because
the thing that would invoke it is a durable job runner owned by `munaxa/munaxa-platform`. The
capability is complete and **dormant**.

---

## 1. Objective

Phase 16E asked whether Workflow may execute a business action **without a human at the other end of
a request**, and if so, to build exactly one such action under an approved contract — with an
auditable record, a durable identity, and no scheduler, worker or synthetic actor anywhere in this
repository.

## 2. Starting state

Phase 16D closed at `730502a` with escalation delivered and four decisions open. Phase 16E opened
with **nine decisions `OPEN`** and **zero production changes**, and the register recorded them as
`OPEN` for the whole of that interval rather than reading approval into the instructions that
described them.

Eight **contract gaps** were found before any code was written: machine authorization, an
infrastructure execution context, `JobPort` being enqueue-only, a closed history vocabulary, no SLA
action defined by any Workflow rule, no expiry trigger, no Organization calendar contract, and a
notification intent that could not address a recipient. Each was reported and stopped on rather than
worked around.

## 3. Approved decisions

| ID | Decision | Status |
|---|---|---|
| D-16E-01 | Does Phase 16E exist? | **APPROVED** |
| D-16E-02 | Automatic execution | **APPROVED** |
| D-16E-03 | Execution ownership → **Platform** | **APPROVED** |
| D-16E-04 | `JobPort` ownership | **APPROVED** |
| D-16E-05 | SLA action | **APPROVED**, narrowed by G-5 |
| D-16E-06 | Expiry action | **APPROVED**, suspended by G-6 |
| D-16E-07 | Notification **intent** | **APPROVED** |
| D-16E-08 | Business-day SLA | **APPROVED**, unopened (not required) |
| D-16E-09 | Idempotency | **APPROVED** |
| D-16E-10 | The first automatic business action → **automatic service-level reminder** | **APPROVED** |
| D-16E-11 | The reminder's history event — its *existence* | **APPROVED** |
| D-16E-12 | Authorization to modify Identity for the recipient contract | **RESOLVED** — no new permission required |
| D-16E-13 | The **concrete** reminder history contract | **APPROVED** |
| D-16E-14 | How the runner discovers a due reminder | **APPROVED** |

**Fourteen approved, one resolved, none open.**

### Contract-gap resolutions

| Gap | Resolution | State |
|---|---|---|
| G-1 machine authorization | approved | **closed** — `workflow.reminder.execute`, no wildcard, no bypass |
| G-2 infrastructure execution context | approved | **closed** — `MachineContext` in the kernel |
| G-3 `JobPort` enqueue-only | approved, with extension | **closed** — the execution half is declared |
| G-4 automatic history | approved in requirement, **withheld in vocabulary** | **closed by D-16E-13** — `step-reminded`, with provenance moving in the same change |
| G-5 SLA action | **AMENDED** — withheld until an action is named | **closed by D-16E-10** — the reminder is that action |
| G-6 expiry | **AMENDED** — withheld until an expiry behaviour is named | **still withheld.** No expiry action has been named. **OPEN DECISION**, nothing built |
| G-7 Organization calendar | approved, bounded | **unopened** — business days are not required by the approved action |
| G-8 notification recipient | approved, bounded | **closed** — `identity.membership-recipient` |

## 4. Implemented capabilities

| Capability | Where |
|---|---|
| `MachineContext` — the third `ExecutionContext` member | `packages/kernel/src/tenancy/tenant-context.ts` |
| `JobExecution` / `JobOutcome` / `JobHandler` / `JobPort.register` | `packages/kernel/src/ports/index.ts` |
| `identity.membership-recipient` — bounded, one identifier in, one out | `packages/modules/identity/src/application/membership-recipient.query.ts` |
| `workflow.reminder.execute` — the machine-only permission | `packages/modules/workflow/src/application/workflow-permissions.ts` |
| `workflow.remind-step` — the automatic business action | `.../application/remind-step.use-case.ts` |
| `workflow.due-reminders` — the bounded discovery read | `.../application/due-reminders.query.ts` |
| `step-reminded` history event + execution provenance | `.../domain/history.ts`, migration `20260820100000_workflow_reminder` |
| `workflow_history_reminder_idx` — the idempotency claim | same migration |

## 5. Closure audit — the required matrix

| Requirement | Status | Evidence | Owner |
|---|---|---|---|
| **Reminder business action** | **COMPLETE** | `workflow.remind-step`, D-16E-10, six named refusals, `workflow-reminder.test.ts` + `workflow-reminder-refusals.test.ts` | Work |
| **Reminder history contract** | **COMPLETE** | `step-reminded`, D-16E-11 + D-16E-13; CHECK widened to ten events; four provenance columns; both actor columns null under machine execution; `workflow-reminder-persistence.integration.test.ts` | Work |
| **Reminder idempotency** | **COMPLETE** | partial unique index `workflow_history_reminder_idx` (ADR-0071 — a `select` then `insert` is not idempotent under concurrency); the history row *is* the claim | Work |
| **Identity recipient** | **COMPLETE** | `identity.membership-recipient` on the pre-existing `identity.membership.read`, reached through the bounded service grant (ADR-0043); **no new permission**, G-8 stop clause not triggered | Work |
| **Machine execution context** | **COMPLETE** | `MachineContext` — tenant + execution identity + correlation; `currentMembershipId()` is `undefined`; `machine-context.test.ts` | Work |
| **Machine authorization boundary** | **COMPLETE** | `workflow.reminder.execute` declared by exactly two handlers, asserted; no human permission opens either; `*`, `workflow.*`, `workflow.reminder.*`, `workflow.reminder` each refused | Work |
| **`JobPort` execution contract** | **COMPLETE as a contract, and only as a contract** | `JobExecution`, `JobOutcome`, `JobHandler`, `register` are declared in the kernel. **No adapter implements them, anywhere in this repository** — the same absence letters, performance, career and learning already document | Work (contract) / **Platform (implementation)** |
| **Due-reminder discovery** | **COMPLETE** | `workflow.due-reminders`, D-16E-14, `2e70fa4`; two identifiers per row, no tenant field, no person, no route; `workflow-due-reminders.integration.test.ts` | Work |
| **Scheduler** | **BLOCKED — Platform-owned** | D-16E-03 assigns scheduling, job triggering, retry mechanics and worker lifecycle to Platform. Building one here is forbidden by that same decision. Nothing in this repository schedules anything | **Platform** |
| **Actual job runner** | **BLOCKED — Platform-owned** | No `JobPort` adapter exists. Every reference to `JobPort` in production source is a comment explaining its absence | **Platform** |
| **Scheduled end-to-end execution** | **BLOCKED — Platform-owned** | Follows from the two rows above. Explicitly **NOT VERIFIED** | **Platform** |
| *Automatic expiry action* | **OPEN DECISION** | G-6 withholds implementation until an exact expiry behaviour is named. None has been. Nothing built | Owner |
| *`SLARule` entity* (D-16D-01) | **OPEN DECISION** | Never approved, nothing built; the per-template target remains sufficient | Owner |
| *Business-day SLA* (D-16E-08 / G-7) | **NOT IN SCOPE** | Not required by the approved action; the Organization contract stays unopened | — |
| *Notification delivery* | **NOT IN SCOPE** | Phase 17's, by that phase's own specification. Workflow emits **intent** only | Phase 17 |
| *Workflow analytics* | **NOT IN SCOPE** | Phase 20's, by that phase's own specification | Phase 20 |
| *Candidate enumeration* | **NOT IN SCOPE** | Refused by D-16D-16, never reopened | — |

**Nothing is called complete because a contract exists.** `JobPort`'s execution half is recorded as a
contract and its implementation as Platform's, on its own row, deliberately.

## 6. Work-owned verification

**Security and tenancy guarantees**

- **Tenant identity comes from the execution context, never from a payload.** There is no `tenantId`
  parameter on the discovery query, none in its reply, and none in the command's payload. The
  repository binds `transaction.tenantId`; row-level security filters again beneath it.
- **No system actor, no service credential, no wildcard, no impersonation, no permission bypass, no
  internal-only authorization, no scheduler identity.** A machine executes as
  `service:<clientId>` / `apikey:<keyId>` / `system:<component>` supplied by the platform, and holds
  **no membership** — `currentMembershipId()` returns `undefined` under a machine context, structurally.
- **Both human actor columns are null on an automatic entry**, enforced by
  `workflow_history_execution_not_human_check`. A row naming both an approver and an execution is
  refused by the database.
- **RLS is enabled and forced** on `workflow_history` (ADR-0030, `app_protect_table`). An automatic
  entry is visible in its own tenant and invisible in another, **with both rows confirmed to exist**,
  so the count is a policy filtering rather than a row never written. A tenant cannot write an
  automatic entry into another tenant's rows.
- **History is append-only.** Update and delete both raise `workflow_history_immutable`; the claim
  cannot be released.
- **No candidate enumeration.** Discovery returns two identifiers and no person — not the approver,
  requester, manager or workforce user, and no parameter that could ask for one. D-16D-16 stays closed.
- **Neither machine handler has an HTTP route**, under any spelling, asserted in both directions.

**Idempotency** — `workflow_history_reminder_idx`, a partial unique index on
`(tenant_id, step_id) where event = 'step-reminded' and deleted_at is null`. The history row is itself
the idempotency record: there is no separate claim table and no flag anything has to maintain
(ADR-0070). Discovery's anti-join is a **narrowing, not the guarantee**.

**Concurrency** — proved with **two real connections overlapping in time, no sleeps**: exactly one
commits, the loser takes `duplicate:workflow_history_reminder_idx`, its transaction aborts whole, and
one row survives bearing the winner's identity. Two runners discovering the same step is correct
rather than tolerated.

**Migration state** — **25 migrations, up to date, no drift.** Phase 16E added **one** migration
(`20260820100000_workflow_reminder`); D-16E-14 added **none** — the discovery read uses columns and
the index that already existed.

**Tests** — at the verified commit: `@work/workflow` **902 tests / 75 files**, `@work/api` **777
tests / 84 files**, repository total **4,160 tests**, all passing.

## 7. Final gate status

Full gate at `2e70fa4`, with production code unchanged since:

| Gate | Result |
|---|---|
| `pnpm standards` | **PASS** — no violations · 176 models · 17 catalogue sets · 1,752 files, no cycles, no unused dependencies |
| `pnpm format:check` | **PASS** |
| `prisma validate` | **PASS** |
| `prisma migrate status` | **PASS** — 25 migrations, up to date, no drift |
| `turbo run build lint typecheck test --force --concurrency=1` | **PASS** — 108 tasks, 108 successful, 0 cached, 12m45s |

**Turbo's own exit code was `0`**, captured directly from the process. It was not read from `tail`,
`grep`, `head`, `tee` or any pipeline. This closure checkpoint changes documentation only, so the
first four gates were re-run and the full gate was not: no production file differs from the tree the
full gate passed on.

## 8. Platform-owned remaining dependency

**Required in `munaxa/munaxa-platform`** — the full contract is in
[`phase-16e-platform-runner-contract.md`](phase-16e-platform-runner-contract.md):

1. A **job runner implementing `JobPort`**, including `register` and delivery.
2. The runner authenticates as a **non-human principal** holding `workflow.reminder.execute` and
   nothing else of Workflow's. Platform already implements the principals (`ServicePrincipal`,
   `ApiKeyPrincipal`, `SecurityContext`); they are simply unconsumed.
3. The runner constructs a **`MachineContext`** per §3 of that contract and runs the handler inside it,
   taking the tenant **from the principal and never from the job payload**.
4. The runner connects as a role with **no `BYPASSRLS`**.
5. ~~The Workflow discovery query~~ — **discharged** by `workflow.due-reminders` (D-16E-14).
6. The Platform-side tests enumerated in that contract pass.

The runner's loop is: `workflow.due-reminders` (bounded, cursor-paged) → per row,
`workflow.remind-step`. A discovered row is a **candidate, not a claim**; the command re-derives every
rule inside its own transaction and refuses a stale one by name.

**No Platform change is required to make anything in this repository correct.** Work is finished; the
capability waits.

## 9. Explicitly unimplemented

Not built, and none with a placeholder anywhere: scheduler · cron · background worker · polling loop ·
queue consumer · broker · outbox · timer · system actor · fake machine user · service credential ·
Platform authentication · `JobPort` adapter · lease, reservation or claim column · automatic
escalation · automatic expiry, rejection or skip · business-day SLA · SLA breach persistence · a
generic automation framework or action enum · candidate enumeration · notification **delivery** ·
Workflow analytics · Admin mutation or authentication · portals.

## 10. Known limitations

- **The reminder fires for nobody until Platform ships a runner.** It is reachable only by a machine
  context, and no machine context is constructed anywhere.
- **A notification intent is recorded and not delivered.** `RecordingNotificationPort` is what
  production composes, following Performance's precedent: intent is a real record; delivery is a
  missing dependency (Phase 17's).
- **Expiry stays derived**, and no automatic expiry action exists — G-6 withholds one until the owner
  names the exact behaviour.
- **Escalation remains manual.** Nothing escalates by itself; 16D's command exists only at the end of
  a request somebody made.
- **`workflow.due-reminders` has no HTTP surface**, by design. It is unreachable except through a
  machine principal, which is why its correctness is proved at the application and persistence layers
  rather than end to end over the wire.
- The `JobPort` absence is **programme-wide, not 16E-specific**: letters, performance, career and
  learning each document the same missing adapter for their own deferred work.

## 11. Final decision state

**Approved and built:** D-16E-01…05, 07, 09, 10, 11, 13, 14 · G-1 · G-2 · G-3 · G-4 · G-8.
**Approved and deliberately unopened:** D-16E-08 · G-7.
**Resolved:** D-16E-12.
**Open decisions, nothing built:** the expiry action (G-6 / D-16E-06's execution half) · `SLARule` as
an entity (D-16D-01) · whether Admin displays automatic execution state (D-16D-15, gated by D-16D-10).
**Closed and not reopened:** D-16D-08 (the snapshotted denominator) · D-16D-16 (no candidate
enumeration) · D-16D-10 (Admin authentication outside scope).

## 12. Closure statement

**Phase 16E is complete on the Munaxa Work side.** Every Work-owned requirement of the phase is
implemented, tested against real PostgreSQL under an unprivileged role, verified by the full gate, and
merged. No Work-owned requirement remains.

The one remaining dependency is **outside this repository**: a durable job runner in
`munaxa/munaxa-platform`. It is documented precisely rather than approximated, and it was not worked
around — no scheduler, worker, synthetic actor or authentication was built here to make the phase
appear finished.

**Scheduled reminders are not operational, and will not be until Platform supplies the runner.**
