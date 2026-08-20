# Phase 16D — Audit

**Verification only. No production behaviour was modified.** This checkpoint is the *audit* the
authoritative plan proposes as its eighth ([`phase-16d-plan.md`](phase-16d-plan.md) §12); final
closure follows it and is **not** performed here.

Audited at `368c69f`, working tree clean.

---

## 1. Which checkpoint this is, and why

The plan proposes nine checkpoints ending **8 — Audit** and **9 — Final closure**. Execution
diverged in numbering because three approval gates were interleaved (8A, 8B, 8C) and the Admin work
split across two passes, so the delivered sequence runs to eleven. Mapped to the plan:

| Plan | Delivered by |
|---|---|
| 1 Definition of Ready | Checkpoint 1 (`9654b2a`) |
| 2 Domain | `ae148c6`, `f6115dc` |
| 3 Schema | `5a7782a`, `65eae92` |
| 4 Application | `445c2f7` |
| 5 Repositories | `50269ee` |
| 6 API | `3f14f7a` |
| 7 Admin — read-only display | `535ca9b` (partial, two requirements stopped) + `368c69f` (completed) |
| **8 Audit** | **this document** |
| 9 Final closure | **not started** |

The plan states plainly: **"No infrastructure checkpoint is proposed."** Nothing in it authorizes a
scheduler, automatic escalation, expiry, notifications or business-day work, and this audit invents
none.

---

## 2. Domain

| Claim | Result |
|---|---|
| Seven approved eligibility rules enforced | **Verified.** Eight named refusals: three about the branch (`escalation-instance-not-running`, `escalation-branch-not-awaiting`, `escalation-branch-is-unanimous`) and five about the person (`escalation-approver-already-assigned`, `escalation-already-escalated`, `escalation-approver-is-the-requester`, `escalation-approver-already-decided`, `escalation-approver-not-eligible`) |
| All eight distinct | **Verified** — one assertion covers the whole set (`workflow-escalation-eligibility.test.ts`) |
| D-16D-17 (A) — one refusal for inactive **and** missing | **Verified** — asserted by name, and asserted *not* to name which case applied |
| D-16D-14 terminal set = `approved`, `rejected`; `skipped` **not** terminal | **Verified**, `skipped` asserted as an admission rather than an absent refusal |
| `unanimous` refuses escalation | **Verified**, and asserted to win over a person-level refusal |
| Escalation adds; never replaces or removes | **Verified** — the command writes one step and reads no existing step back |
| Idempotency identity = `(instance, ordinal, membership)` | **Verified** — `escalationIdentity`, and the domain does **not** claim to enforce it |
| Exactly one `step-escalated`, and no decision invented | **Verified** |

**D-16D-08 unchanged.** `assignedOf` still filters `escalatedAt === undefined`; the denominator,
threshold, `outstanding` (a count, never a subtraction, so never negative) and `unresolved` are as
16B left them. No approved 16D option altered what the tally counts.

---

## 3. Schema

| Claim | Result |
|---|---|
| **24 migrations**, no drift | **Verified** — `prisma migrate status`: *24 migrations found · Database schema is up to date* |
| Schema valid | **Verified** — `prisma validate` |
| Migration #24 is additive | **Verified** — `workflow_step.escalated_at` nullable; the history check constraint replaced with nine values; one index |
| Ninth history event | **Verified** — `WORKFLOW_HISTORY_EVENTS` has nine, `step-escalated` among them, and the constraint agrees |
| **Partial** unique index | **Verified** — `workflow_step_escalation_idx on workflow_step (tenant_id, instance_id, ordinal, approver_membership_id) where escalated_at is not null and deleted_at is null` |
| Tenant leads the key | **Verified** — two tenants may hold the same triple without colliding |
| RLS, append-only history | **Verified** by the existing integration suites, under a role asserted `rolsuper=false`, `rolbypassrls=false` |
| **No new schema in 16D beyond #24** | **Verified** — Checkpoints 8B, 8C, 9 added none |

---

## 4. Persistence

Mapper parity, round trip, concurrent duplicate protection and tenant isolation are covered by
`workflow-escalation-persistence.integration.test.ts` (11 tests) and
`workflow-escalation-uniqueness.integration.test.ts`, all against real PostgreSQL.

`escalated_at` is bidirectionally mapped — in `stepColumns`, read in `stepState`, written in
`stepValues` — which is what makes the tally correct on the *second* read rather than only in memory.

---

## 5. Application

| Claim | Result |
|---|---|
| Permission declared and exact | **Verified** — `workflow.approval.escalate`, implied by nothing |
| **Ten** Workflow permissions, none added since | **Verified** |
| Not delegable | **Verified** — `DELEGABLE_SCOPES = [approvalDecide, '*']` |
| One transaction | **Verified** — a single `unitOfWork.execute`; step and history entry commit together or not at all |
| Failure atomicity | **Verified**, including the Identity-outage path: the port raises and nothing is written |
| No application-level tally arithmetic | **Verified** — the handler computes no denominator, threshold or outcome |
| Actor from context, never the body | **Verified** — `currentMembership()`, refusing `escalation-actor-unknown` |
| One Identity read, for the named membership only | **Verified** — asserted as a whole array, so a second read or a read of anybody else fails |

---

## 6. API

| Claim | Result |
|---|---|
| **23 routes**, one per handler, reconciled both directions | **Verified** |
| **13 commands / 10 queries** | **Verified** |
| DTO whitelist | **Verified** — `EscalateBranchBody` has exactly `ordinal` and `approverMembershipId`; 17 other fields are refused **400** by `forbidNonWhitelisted` |
| No `tenantId`, no actor field | **Verified** — both are among the refused 17 |
| Error mapping | **Verified** — 400 malformed · 403 wrong permission · 404 unknown approval · 422 business refusal |
| Duplicate escalation is **not** silently 200 | **Verified** — 422 `escalation-already-escalated`, asserted explicitly not to be 200 |
| **`escalatedAt` never published** | **Verified** — the response-body scan forbids `escalatedat`, `escalatedon`, `escalatedby`, `escalatedbymembershipid`, `escalationreason`, `escalationactor`, `sourcegroupid`, `employment`, `reporting`, `manager` |
| `escalated: boolean` present on every step | **Verified**, with exactly one `true` on an escalated approval and all `false` on an untouched one |
| No forbidden endpoint | **Verified** — `/workflow/me`, `my-manager`, `/managers`, `/sla`, `/escalations`, `/expiry`, `/routing`, `/analytics`: **zero production files** |

---

## 7. Admin

| Claim | Result |
|---|---|
| `How added`, Assigned / Escalated | **Verified**, both languages, no raw keys |
| Marker read from the published boolean | **Verified** over source: contains `step.escalated`, and none of `Math.`, `Date.now`, `new Date`, `.length >`, `.assigned`, `.threshold`, `.outstanding`, `tallies`, `history`, `fetch(` |
| No history join for the marker | **Verified** |
| Request budget unchanged | **Verified** — 5 empty / 10 one row / 10 fifty rows / 1 on first failure |
| **No candidate picker** | **Verified** — `candidate`/`eligible` appear in a test file only |
| **No mutation architecture** | **Verified** across all tracked Admin files: `use server` 0 · `use client` 0 · `<form` 0 · `action=` 0 · `useState` 0 · `useEffect` 0 · `route.ts` 0. The one `<button` is the bootstrap design-system page, unrelated and pre-existing |
| **No authentication workaround** | **Verified** — `Bearer` 0 · `credentials` 0 · `csrf` 0 · `cookie` 0. `Authorization` appears four times, all prose in other modules saying it is *not* authorization; no HTTP header anywhere |

---

## 8. Negative space — infrastructure

Comment-stripped scan of every production file in `packages/modules/workflow/src`,
`apps/api/src/workflow` and `apps/admin/src/workflow`:

`JobPort` 0 · `scheduler` 0 · `cron` 0 · `setInterval` 0 · `setTimeout` 0 · `worker` 0 · `broker` 0 ·
`autoEscalat` 0 · `escalateAfter` 0.

Three words survive in code, all three in `apps/admin/src/workflow/status.tsx` and all three as
`workflow.withheld.*` catalogue keys — `businessDays`, `notificationDelivery`, `outbox` — i.e. the
entries that **declare these capabilities absent**. That is the honest opposite of implementing them.

**Escalation remains human-triggered.** Nothing invokes the command but a request.

---

## 9. Defects found

**One, documentation-level, not fixed here.**

**D-1 — a stale claim in Admin prose.** `apps/admin/src/workflow/status.tsx:23` still reads
*"…no escalation column…"* among the things this page does not show. Checkpoint 9 added exactly such
a column (`How added`), so the sentence is now false.

*Impact:* none on behaviour, on any contract, or on any assertion — it is a comment. *Why not fixed:*
this checkpoint audits and does not modify production files. It is a one-line correction and belongs
to the closure checkpoint.

No other defect was found. In particular no behavioural, contractual, security, tenancy or
concurrency defect.

---

## 10. Decided versus implemented

The distinction matters more at the end of a phase than anywhere else.

| Decision | Decided | Implemented |
|---|---|---|
| D-16D-09 marker | A | **yes** — published and rendered |
| D-16D-11 bounded port | B, predicate | **yes** — `MembershipStandingPort` |
| D-16D-12 active membership | A, command invariant | **yes** — seventh rule, write path |
| D-16D-13 requester | B, refused | **yes** |
| D-16D-14 D-5 | A, `skipped` excluded | **yes** |
| D-16D-15 delegation | D, decision-execution only | **yes, as a proven absence** — the port is spied on and never called |
| D-16D-16 enumeration | A, none | **yes, as a proven absence** — no candidate query exists |
| D-16D-17 refusal mapping | A, one refusal | **yes** |
| D-16D-18 Identity contract | approved | **yes** — `identity.membership-standing` |
| D-16D-19 authorization to modify Identity | approved | **yes** |
| **D-16D-10 authentication** | **A — outside Phase 16D** | **not implemented, and must not be** |
| D-16D-01, 03, 06, 07 | **never approved** | **not implemented** |

**Three statements this audit will not make**, because each would be false:

- that Admin can *invoke* escalation — it cannot, and D-16D-10 (A) is why;
- that a candidate picker exists — it does not, and D-16D-16 (A) says so deliberately;
- that automatic escalation exists — the human command existing is not that, and no runner owns it.

`JobPort` remains a kernel contract with **no Workflow implementation**, assigned to no phase.

---

## 11. NOT VERIFIED

Phase 16C's twenty-two stand, reduced by exactly the items 16D delivered. Still not verified:

business days · scheduled firing · `JobPort` · durable scheduler · role approvers · dynamic role or
group directory · external approvers · notification delivery · analytics · approval expiry ·
automatic delegation expiry · outbox · broker · worker · self-service portals · routing intelligence
beyond the approved manager resolution · cohort query · tenant-wide aggregates · volumes above
100,000 · concurrency beyond two connections · **authentication through the real Platform adapter** ·
**automatic escalation**.

Also not verified by this audit: browser rendering (all Admin suites assert static markup — there is
no DOM environment), and right-to-left *layout* as opposed to Arabic content.

---

## 12. Gates

Recorded in the final report accompanying this checkpoint. `prisma validate` and
`prisma migrate status` were run here: schema valid, 24 migrations, **no drift**.
