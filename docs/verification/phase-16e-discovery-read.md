# Phase 16E — D-16E-14 · The discovery read

`workflow.due-reminders`: the read that tells a job runner **which** steps are due an automatic
service-level reminder. Approved by the owner, implemented, tested and verified.

It exists because the approved reminder was **executable and not discoverable**. `workflow.remind-step`
takes an `instanceId` and a `stepId`, and nothing published could answer where those come from — so a
Platform runner could invoke the command and had nothing to invoke it with. The gap, and the audit of
every registered query that could not close it, are in
[`phase-16e-register.md`](phase-16e-register.md#d-16e-14--how-the-runner-discovers-a-due-reminder--approved).

---

## 1. The published contract

```
query:       workflow.due-reminders
request:     { asAt: Date, size?: number, cursor?: string }
reply:       CursorResult<DueReminderView>  →  { items: { instanceId, stepId }[], nextCursor? }
permission:  workflow.reminder.execute
context:     tenant-scoped (a MachineContext in production)
```

`DueReminderView` has **two fields and no others**. They are exactly the arguments the command takes,
so a runner carries a candidate straight to it without learning anything about the approval on the way.

## 2. What it will not tell you, and why each refusal is deliberate

**No tenant.** There is no `tenantId` in the request and none in the reply. The tenant comes from the
execution context the platform set; the repository binds `transaction.tenantId`; row-level security
filters again beneath that. A caller cannot name a tenant, so a caller cannot choose one — which is the
whole of the rule that tenant identity never arrives as a business field.

**No person.** Not the approver, not the requester, not a manager, not a workforce user, and no
parameter that could ask for one. The recipient is resolved later and separately, by
`identity.membership-recipient`, from the step the *command* re-reads inside its own transaction. A
query that returned the approver would be a directory with a schedule attached to it, and **D-16D-16 —
no candidate enumeration — stays closed** precisely because this read discovers *work* rather than
*people*.

**No human permission.** It declares `workflow.reminder.execute`, the same capability the command
holds, rather than a second `reminder.discover` grant. Discovering the work and doing it are one
capability held by one principal: a separate grant would be one somebody could hold *alone*, and a
principal that could enumerate a tenant's overdue approvals without being able to act on them is a
reporting capability nobody approved. The API composition suite asserts that permission is declared
**exactly twice** — by this query and by the command it feeds — so a third holder cannot appear
unnoticed. The application authorization suite tries every other permission in the vocabulary one at a
time, plus `*`, `workflow.*`, `workflow.reminder.*` and `workflow.reminder`, and each is refused.

**No HTTP route.** Under any spelling — asserted in both directions by `workflow.routes.spec.ts`, which
names the unrouted pair rather than checking that some list is non-empty. A route could only ever
answer 403, and offering one would invite somebody to wire authentication to it later and make it mean
something.

**No clock.** `asAt` is supplied. Nothing in this module reads the time for itself, and a runner
passing one instant to every page of a sweep sees a single horizon rather than a moving one.

## 3. It narrows; it does not decide

A returned row is a **candidate**, not a claim. Nothing is reserved, leased, flagged or marked. Two
runners reading concurrently will both see a step neither has claimed, and that is **correct rather
than tolerated**: the guarantee lives in `workflow_history_reminder_idx`, where the database can
arbitrate it, because *a `select` followed by an `insert` is not idempotent under concurrency*
(ADR-0071). Discovery reduces wasted work and decides nothing.

Every rule this query applies is re-applied by `workflow.remind-step`, from rows read inside the
command's own transaction. A candidate that goes stale between the two — answered, cancelled, ended,
already reminded — is refused **by name** rather than acted on, which is why the runner needs no
separate notion of staleness and cannot forget to check for it.

The `not exists` anti-join against `step-reminded` history is therefore a **narrowing, not the
guarantee**: it avoids handing a runner work that is already certainly done, and claims nothing about
work in flight.

## 4. Bounded, always

- `size` is **clamped, not trusted**: 1…`MAXIMUM_DISCOVERY_PAGE` (200), default
  `DEFAULT_DISCOVERY_PAGE` (100). A larger request is reduced rather than refused — a runner asking for
  too much is a misconfiguration, not an attack. A non-integer, a zero or a negative falls back to the
  default.
- The maximum is the kernel's own `MAXIMUM_PAGE_SIZE`, reused rather than re-decided, so a reader meets
  one page-size policy in this repository instead of two.
- Continuation is a **cursor over `step.id`**, never an offset. An offset over a set being written to
  repeats rows and skips others as it shifts — precisely what a discovery loop must not do. A uuid v7
  is time-ordered and immutable, so ordering by it is stable.
- The query fetches `size + 1` so `cursorResult` can say whether another page exists without a second
  query and without a count over a changing set.

## 5. The due condition, and why the SQL says `24 hours`

```sql
i.status = 'running'
AND s.status = 'awaiting'
AND s.service_level_count IS NOT NULL
AND s.awaiting_at IS NOT NULL
AND s.awaiting_at + (interval '1 hour' * s.service_level_count
      * (case s.service_level_unit when 'hours' then 1 else 24 end)) < $asAt
```

**`interval '1 hour' * 24` is not a long way of writing `interval '1 day'.`** The domain's `dueAt` adds
`count × 86_400_000 ms` for a `days` target — exactly twenty-four hours. PostgreSQL's `interval '1 day'`
is *calendar* arithmetic on a `timestamptz`: across a daylight-saving boundary it is twenty-three or
twenty-five hours, and the query would then disagree with the command about whether a step was due,
twice a year, for one hour.

**Strictly `<`**, which is `asAt > dueAt` read from the other side. Due exactly on the boundary is
`within` for every other reader of this target, and a candidate offered at that instant would be
refused by the command it was offered to.

The in-memory store mirrors the same question by calling the **domain's** `serviceLevelState` rather
than restating the arithmetic — which is what stops the fake and the database from drifting apart while
both look right on their own.

## 6. Files

| File | What it holds |
|---|---|
| `application/due-reminders.query.ts` | the handler, the page bounds, the permission |
| `contracts/execution-views.ts` | `DueReminderView` — two fields |
| `application/workflow-ports.ts` | `DueReminder`, `StepStore.dueForReminder` |
| `infrastructure/step-due-reminders.ts` | the SQL and the reasoning behind it |
| `infrastructure/instance.repository.ts` | delegates to the above |
| `application/in-memory-due-reminders.ts` | the fake, mirroring the SQL through the domain |

## 7. Verification

| Gate | Result |
|---|---|
| `pnpm standards` | **PASS** — no violations · 176 models · 17 catalogue sets · 1,752 files, no cycles |
| `pnpm format:check` | **PASS** |
| `prisma validate` | **PASS** |
| `prisma migrate status` | **up to date, no drift** — this change adds **no migration** |
| `turbo run build lint typecheck test --force --concurrency=1` | **PASS** — 108 tasks, 108 successful, 0 cached, 12m45s. Turbo's own exit code, captured directly: `0` |

**No migration, and no schema change of any kind.** The query reads columns that already exist and the
index that already arbitrates the claim. A discovery read that needed a new column would be a stored
flag something has to maintain, and *a stored flag that nothing maintains is worse than no flag*
(ADR-0070).

Proved against **real PostgreSQL**, not asserted in prose
(`infrastructure/workflow-due-reminders.integration.test.ts`): the boundary is exclusive; `days`
arithmetic matches the domain's twenty-four hours; a step already reminded is excluded; a cancelled or
completed instance's steps are excluded; the cursor neither repeats nor skips across pages; the page
bound holds; and **RLS filters the read both ways** — one tenant's due steps are invisible to another
with both rows confirmed to exist, so the count is a policy filtering rather than a row never written.

The application suite (`application/workflow-due-reminders.test.ts`) proves the authorization surface,
the clamping, the cursor, the absence of any person in the reply, and that the query writes nothing.

Whole-suite counts at the verified commit: **@work/workflow 902 tests / 75 files**, **@work/api 777
tests / 84 files**, both green.

**Still NOT VERIFIED**, unchanged by this work: scheduled firing · a durable runner · `JobPort` delivery
end to end · retry semantics under a real runner · notification *delivery*.

## 8. What this did not build

No scheduler · no cron · no worker · no polling loop · no queue consumer · no broker · no outbox · no
timer · no system actor · no service credential · no Platform authentication · no `JobPort` adapter
that pretends to execute jobs · no lease, reservation or claim column · no migration · no change to
Platform.

Criterion 5 of [`phase-16e-platform-runner-contract.md`](phase-16e-platform-runner-contract.md) is
discharged. Criteria 1–4 and 6 are Platform's and remain open.
