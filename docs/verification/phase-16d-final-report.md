# Phase 16D — Final Report

**Phase 16D — Escalation in Workflow — is COMPLETE.**
**Phase 16E has not started.**

Closed at `504c1f5` (audit) with this closure commit. **Documentation only**; no production or test
code was changed by closure.

---

## 1. What the phase turned out to be

16D began as *"Time in Workflow"* — escalation, expiry, business-day targets, scheduled execution.
The Definition of Ready ([`phase-16d-plan.md`](phase-16d-plan.md)) found most of that either already
delivered by 16C, decided against, or blocked on infrastructure nobody owns, and stopped on three
conditions. What survived approval was **one capability**: a human adds an approver to a branch that
is stuck.

Everything else named in the original brief is recorded below as **decided but not implemented**, or
as never approved at all. The distinction is the point of this document.

---

## 2. Implemented

Each of these exists in the repository and is covered by tests that run in the repository-wide gate.

| Capability | Where |
|---|---|
| Human-triggered escalation command `workflow.escalate-branch` | `application/escalation.use-case.ts` |
| Permission `workflow.approval.escalate`, implied by nothing, **not delegable** | `application/workflow-permissions.ts` |
| Escalation domain act and its **eight named refusals** | `domain/escalation.ts` |
| Seven approved eligibility rules, all on the **write path** | ditto |
| Stable snapshotted assigned denominator (D-16D-08) | `domain/branch.ts` — `assignedOf` filters `escalatedAt === undefined` |
| Escalated votes count fully for `majority` and `first-response` | `domain/branch.ts` |
| `unanimous` refuses escalation | `escalation-branch-is-unanimous` |
| Ninth history event `step-escalated` | `domain/workflow-vocabulary.ts`, migration 24 |
| `workflow_step.escalated_at` persistence | migration 24 |
| Bidirectional PostgreSQL mapper | `infrastructure/workflow-record-rows.ts` |
| **Partial** unique index `workflow_step_escalation_idx` | migration 24 |
| Concurrency protection by that index (ADR-0071) | integration suites |
| RLS / tenant isolation | forced policies, asserted under an unprivileged role |
| API route `POST /instances/:instanceId/escalation` | `api/instance.controller.ts` |
| Public marker `WorkflowStepView.escalated: boolean` (D-16D-09) | `contracts/views.ts`, `application/workflow-views.ts` |
| Admin **Assigned / Escalated** rendering, both languages | `apps/admin/src/workflow/instances.tsx` |
| Identity contract `identity.membership-standing` (D-16D-18) | `packages/modules/identity/src/application/membership-standing.query.ts` |
| Bounded Workflow → Identity port `MembershipStandingPort` (D-16D-11) | `application/workflow-membership-standing.ts` + adapter in `apps/api` |
| Active-membership enforcement (D-16D-12) | seventh eligibility rule |
| Audit verification | [`phase-16d-audit.md`](phase-16d-audit.md) |

### The seven eligibility rules, in the order they fire

Three about the **branch**, then five about the **person** — eight refusals in total, each its own
name because each sends a different person to fix a different thing:

1. `escalation-instance-not-running`
2. `escalation-branch-not-awaiting`
3. `escalation-branch-is-unanimous`
4. `escalation-approver-already-assigned`
5. `escalation-already-escalated`
6. `escalation-approver-is-the-requester`
7. `escalation-approver-already-decided`
8. `escalation-approver-not-eligible`

---

## 3. Decided but **not** implemented

**A decision is not a capability.** Each row below was settled — some deliberately settled *against*
building anything — and none of them shipped.

| Subject | Decision | State |
|---|---|---|
| **Admin authentication** | **D-16D-10 = A** — outside Phase 16D | **Not implemented, and must not be.** Platform owns authentication (ADR-0001, ADR-0019); ADR-0032 resolves a tenant *from* a principal and does not obtain one |
| **Admin invoking escalation** | consequence of D-16D-10 | **Impossible in the current architecture.** All fifteen Admin loaders send headerless `GET`s; the global guard answers 401 |
| **Candidate enumeration** | **D-16D-16 = A** — none in this phase | **No query, no route, no list.** Intentional |
| **Candidate picker** | consequence of D-16D-16 and D-16D-11 = B | **Does not exist.** A predicate can validate a choice; it cannot produce one |
| **Automatic escalation** | never approved | **Not implemented.** The human command existing is not automation |
| **`JobPort` runner** | never assigned | **No consumer, no adapter, no phase owns one** |
| **Business-day SLA** | deferred at 16C (D-16C-05) | **Absent.** Workflow holds no calendar |
| **Notification delivery** | Phase 17's, by its own specification | **Absent** |
| **Approval expiry execution** | 16C decided expiry is *derived on read* (D-16C-06) | **No written state, nothing fires** |
| **Portal integration** | out of scope | **Absent** |
| D-16D-01, D-16D-03, D-16D-06, D-16D-07 | **never approved** | **Nothing built** |

---

## 4. Decision history, as approved

Preserved as recorded in [`phase-16d-register.md`](phase-16d-register.md); nothing here restates a
decision differently from the way it was approved.

| ID | Subject | Approved |
|---|---|---|
| D-16D-02 | Escalation adds an approver; gets its own permission | Option A, 2026-08-18 |
| D-16D-04 | Only the current awaiting branch may be escalated | Option A |
| D-16D-05 | Phase 16D proceeds, escalation only | Option A |
| **D-16D-08** | Escalation semantics — denominator, threshold, outstanding | Option (iii) · **locked, never reopened** |
| **D-16D-09** | Public `escalated: boolean` marker | A |
| **D-16D-10** | Admin authentication **outside 16D** | A |
| **D-16D-11** | Bounded predicate architecture | B |
| **D-16D-12** | Active membership is a command invariant | A |
| **D-16D-13** | Requester self-approval refused | B |
| **D-16D-14** | Approver already terminal on the instance refused; `skipped` **not** terminal | A |
| **D-16D-15** | Delegation affects decision execution only | D |
| **D-16D-16** | No candidate enumeration | A |
| **D-16D-17** | Inactive **and** missing map to one refusal | A |
| **D-16D-18** | Identity `membership-standing` contract | Approved 2026-08-19 |
| **D-16D-19** | Authorization to modify Identity | Approved 2026-08-19 |

D-16D-01, D-16D-03, D-16D-06 and D-16D-07 remain **OPEN and unbuilt**.

---

## 5. Scope, recomputed from the repository

| Measure | Value | Basis |
|---|---|---|
| Migrations | **24**, no drift | `prisma migrate status` |
| Migrations added by 16D | **1** (#24, additive) | — |
| Workflow tables | **9** | `schema.prisma` |
| Workflow indexes declared in the Prisma model | **8** | `@@index` / `@@unique` on Workflow models |
| Workflow API routes | **23** | reconciled both directions against registered handlers |
| Workflow commands | **13** | +1 in 16D |
| Workflow queries | **10** | unchanged by 16D |
| Workflow permissions | **10** | +1 in 16D |
| Identity queries | **8** | +1 in 16D (`membership-standing`) |
| Workflow ports | **4** — `delegation`, `reportingLine`, `membershipStanding`, `businessDecision` | +1 in 16D |
| Adapters added | **1** — `WorkflowMembershipStanding` | `apps/api` |
| Admin components changed | **1** — `instances.tsx` (one column) | — |
| Localization added | **3 keys × 2 languages** — `label.approverOrigin`, `vocabulary.approverOrigin.{assigned,escalated}`; plus `historyEvent.step-escalated`, `provided.escalation` earlier in the phase | — |
| Tests, repository-wide | **3,994 passing** | full gate |
| Files changed across 16D | **72 files, +9,579 / −336** | `git diff 9654b2a~1..HEAD -- packages apps docs` |

**One limitation, stated rather than papered over.** `workflow_step_escalation_idx` does not appear
in `schema.prisma`, because Prisma's model cannot express a partial index's `where` clause. This is
**not drift** — `prisma migrate status` reports the schema up to date — and it is the established
pattern here: `invitation_one_pending_per_email_key`, `employment_link_one_primary_key` and
`workforce_user_platform_user_id_key` are all partial and all likewise absent. The consequence is
that the Prisma index count understates the database's, so **no aggregate index total is claimed**.

---

## 6. Security and tenancy

| Property | Verified |
|---|---|
| RLS enabled **and forced** on Workflow tables (ADR-0030) | yes, asserted under a role with `rolsuper=false`, `rolbypassrls=false` |
| Tenant predicates preserved | yes — `findRow` filters `tenant_id` explicitly *and* the policy filters again |
| **No tenant identifier accepted from a request** | yes — `tenantId` is among the 17 fields the DTO refuses with 400 |
| **No actor identity accepted from a request body** | yes — `actorMembershipId`, `membershipId`, `onBehalfOfMembershipId` all refused; the actor comes from `currentMembership()` |
| Escalation permission **not delegable** | yes — `DELEGABLE_SCOPES = ['workflow.approval.decide', '*']` |
| **No broad Identity directory access** | yes — the port takes one membership and returns one boolean |
| `identity.membership.read` **reused, not expanded** | yes — 17 Identity permissions before and after; the grant names exactly one |
| No employment or reporting-line data leaks | yes — response scan forbids `employment`, `reporting`, `manager` |
| **`escalatedAt` remains internal** | yes — scan forbids `escalatedat`, `escalatedon`, `escalatedby`, `escalationreason`, `escalationactor` |
| **Only `escalated: boolean` is public** | yes |
| **No service credential or authentication workaround in Admin** | yes — `Bearer` 0, `credentials` 0, `csrf` 0, `cookie` 0 across all tracked Admin files |

Another tenant's membership identifier is **indistinguishable from one that never existed** — RLS
makes it `not_found`, and Workflow maps that to the same refusal as inactive. A membership identifier
is therefore not a probe.

---

## 7. Negative space

Verified absent from production code. **Not implemented / deferred / outside scope** — not "not
needed".

**Endpoints, zero production files each:** `/workflow/me` · `/my-manager` · `/managers` · `/sla` ·
`/escalations` · `/expiry` · `/routing` · `/analytics`.

**Infrastructure, comment-stripped scan of Workflow, Workflow API and Workflow Admin production
files:** `JobPort` 0 · `scheduler` 0 · `cron` 0 · `setInterval` 0 · `setTimeout` 0 · `worker` 0 ·
`broker` 0 · `autoEscalat` 0 · `escalateAfter` 0.

Three words survive in code, all in `apps/admin/src/workflow/status.tsx` and all as
`workflow.withheld.*` catalogue keys — `businessDays`, `notificationDelivery`, `outbox` — the entries
that **declare these capabilities absent**.

Also absent: automatic escalation · automatic expiry · business-day calculation · candidate
enumeration · generic membership directory · Admin authentication workaround.

---

## 8. Invariants preserved

Phase 16B's and 16C's, unchanged by this phase and re-verified by the closing audit:

group snapshot at start · branch semantics · the snapshotted assigned denominator ·
`floor(n/2)+1` majority · quorum as a precondition rather than a rule · `first-response` ·
delegated votes · condition refusals · append-only history · tenant isolation · no cross-module
foreign keys · manager resolved once at start · service level derived on read and stored nowhere.

And 16D's own:

**escalation adds rather than replaces** · escalated steps are **excluded** from the assigned
denominator · `outstanding` is a count and therefore never negative · `unresolved` remains distinct
where reachability requires it · escalation is **human-triggered only** · exactly one `step-escalated`
per addition · duplicates refused by `workflow_step_escalation_idx`.

---

## 9. Gates

Run at closure. **Documentation-only changes, so test counts are expected to be identical to the
audit's — and they are**, which is itself part of the evidence.

| Gate | Result |
|---|---|
| `pnpm standards` | no violations · 176 models · 17 catalogue sets |
| `pnpm format:check` | clean |
| `prisma validate` | valid |
| `prisma migrate status` | 24 migrations · **no drift** |
| `turbo run build lint typecheck test --force --concurrency=1` | recorded in the closure response |

---

## 10. Defects

**One, documentation-level, carried as debt rather than fixed.**

**D-1 — stale claim in Admin prose.** `apps/admin/src/workflow/status.tsx:23` still reads
*"…no escalation column…"*; Checkpoint 9 added one (`How added`).

*Not fixed here.* Closure is documentation-only, and the phase plan does not authorize a production
file change during closure — the 16C precedent (`d30d504`) touched exactly four documentation files
and no production file. Correcting a comment inside a closure commit would set the opposite
precedent for the sake of one sentence. Recorded as **debt** in §11.

**No behavioural, contractual, security, tenancy or concurrency defect was found** by the audit or by
closure.

---

## 11. Debt and limitations

1. **D-1** — the stale comment above. One line, no behavioural impact.
2. **Escalation is API-only.** The capability is complete and unreachable from the portal until
   Platform authentication exists (D-16D-10).
3. **No candidate source.** Even with authentication, D-16D-16 (A) means there is nothing to
   populate a selector from; a picker needs *both* decisions revisited.
4. **Prisma cannot model the partial index** (§5), so the model understates the database.
5. **Four decisions remain OPEN** — D-16D-01, 03, 06, 07 — with nothing built for any of them.

---

## 12. NOT VERIFIED

Carried forward. A decided capability is **not** removed from this list merely because its semantics
were settled — only delivery removes an item.

real Platform authentication · Admin mutation architecture · browser rendering · right-to-left visual
layout · candidate picker · automatic escalation · scheduled execution · durable scheduler ·
`JobPort` runner · notification delivery · analytics · portals · approval expiry execution ·
automatic delegation expiry · business-day SLA · role approvers · external approvers · role or group
directories · outbox · broker · worker · volumes above 100,000 approvals · concurrency beyond the
tested two-connection scenario.

Admin suites assert **static markup** via `renderToStaticMarkup`; there is no DOM environment, so no
browser behaviour is claimed.

---

## 13. Phase status

**Phase 16D — COMPLETE.**
**Phase 16E has not started.** No Phase 16E checkpoint exists, and none was created.
