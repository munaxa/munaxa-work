# Phase 6 — Recruitment: completion report

**Date** 2026-08-09 · **Branch** `claude/phase-6-recruitment` · **Plan**
[`phase-6-plan.md`](phase-6-plan.md) · **Approved decisions** recorded in §0 of the plan before any
code was written.

Every claim below is marked with what backs it:

- **IMPLEMENTED** — built here, and covered by a test that would fail if it broke.
- **CONTRACT AVAILABLE** — the seam exists and is honoured, but the capability behind it belongs to a
  later phase and does not work today.
- **NOT VERIFIED** — believed correct, not proved by anything in this repository.

---

## 1. What was built

| | |
| --- | --- |
| Tables | 11, all under row-level security applied by the creating migration |
| Domain aggregates | 6 — requisition, vacancy, candidate, application, interview, offer |
| Commands | 30 |
| Queries | 12 |
| Permissions | 21 |
| HTTP endpoints | 42 across 9 controllers |
| Source files | 78 in `@work/recruitment`, plus the API composition and the admin screen |
| Tests | **69** in the module (49 unit/application, 20 integration against PostgreSQL) and **8** more in the API |
| Repository total | 954 tests, all passing |

Migration: `prisma/migrations/20260809170000_recruitment/migration.sql`. It creates every table, every
index, every check constraint and the row-level security policy for all eleven, in one file.

---

## 2. The approved decisions, and what each produced

### A-1 — Bounded cross-module service context · **IMPLEMENTED**

`runWithServiceGrant` and `GrantAwarePermissionChecker` in `@work/kernel`
([ADR-0043](../adr/0043-bounded-service-grant.md)), wired in
`apps/api/src/recruitment/recruitment.composition.ts` and
`apps/api/src/identity/identity.module.ts`.

Against the eight required properties:

| Required | How |
| --- | --- |
| The user is still authorized for the Recruitment operation | The grant is entered *inside* a handler the pipeline has already authorized; nothing reaches one before that check |
| Only explicitly permitted cross-domain operations | `permits` is a literal list — no wildcard, no prefix. Five grants, all visible in one file |
| Every operation tenant-scoped | `runWithServiceGrant` throws outside a tenant context |
| Every operation auditable | Every elevation is passed to an observer; the composition root passes the logger |
| No arbitrary People repository access | Recruitment holds a `PeopleDirectoryPort` with three methods, implemented over People's published query and command |
| No arbitrary Organization repository access | One method: `unitExists`, over `organization.unit-ancestry` |
| No second authorization framework | A decorator on the one Platform checker. It adds nothing when no grant is open |
| Extend the existing contract only where necessary | One kernel file, one decorator, no change to `PermissionChecker`'s interface |

Grants cannot nest (entering one inside another throws), and a grant never touches the execution
context — tenant, actor and correlation identifier stay as the request set them, so every audit column
and every event names the human being who asked.

**Proved by** 11 kernel tests (`service-context.test.ts`) and a module test in which a caller holding
only `recruitment.candidate.manage` and `recruitment.candidate.read` successfully matches a candidate
against the person register.

**The Phase 5 authorization composition is unchanged**, as directed. Creating an employment directly
still requires the caller to hold `people.person.read`. Recorded as architectural follow-up **F-1**
below rather than fixed here.

### A-2 — Candidate versus Person · **IMPLEMENTED**

[ADR-0044](../adr/0044-a-candidate-is-not-a-person.md). `recruitment_candidate` has no column for a
national identifier, a passport number, a date of birth, a nationality or a photograph. `person_id` is
null until hire, written exactly once, and unique per tenant by partial index. No matching logic and no
identity-document protection is duplicated: matching goes to People's own search, and creation to
People's own command.

**Proved by** the domain suite (write-once linking), the persistence suite (a second candidate for one
Person is refused by the database) and a test asserting that creating a candidate creates no Person.

### A-3 — Real approval, not `AutoApprovingPort` · **IMPLEMENTED**

[ADR-0045](../adr/0045-requisition-approval-is-real.md). `recruitment_requisition_decision` records the
decision, the actor (from the authenticated context, never the command) and the instant.
`recruitment.requisition.approve` is separate from `.manage`. A decision is never amended: a reversal is
a new row naming the one it reverses, and is refused once hiring has begun. The migration path to
Workflow is documented in the ADR and needs no table or state change; `approval_id` exists and is null.
Nothing in this module consults `ApprovalPort`.

**Proved by** tests asserting the recorded decider, the append-only reversal, and a 403 for a caller who
may manage requisitions but not approve them.

### A-4 — The hire, across module boundaries · **IMPLEMENTED**

[ADR-0046](../adr/0046-the-hire-is-a-saga.md). Four steps, each committing what it achieved.

| Required behaviour | Status |
| --- | --- |
| Employment creation invoked through the Employment **application service** | IMPLEMENTED — `employment.create-employment`, never a repository |
| Person creation through People's application service | IMPLEMENTED — `people.create-person`, plus `people.record-contact` |
| `person_id` write-once with a unique constraint | IMPLEMENTED — aggregate refusal and partial unique index |
| `employment_id` write-once with a unique constraint | IMPLEMENTED — same shape |
| Safely retryable | IMPLEMENTED — re-sending the command is the supported recovery path |
| Partially completed transition detectable | IMPLEMENTED — `hire_state` plus a partial index, exposed as `?unfinishedHire=true` |
| A failed transition never appears successful | IMPLEMENTED — the application keeps its status and is not `hired` |
| Recoverable state exposed for operational retry | IMPLEMENTED — the search filter above, and `recruitment.candidate.hire-incomplete` |
| No false distributed transaction | IMPLEMENTED — the two-transaction limitation is stated, not hidden |
| No direct writes to Employment repositories | IMPLEMENTED — `@work/recruitment` does not depend on `@work/employment` at all |

**Proved by** four hire tests: the happy path, a refusal with no accepted offer, a stopped hire that
stays visible and appears in the reconciliation query, and a retry that converges — one Person and one
Employment after two attempts.

One consequence found during implementation and worth stating: People takes a **caller-supplied**
person number. Recruitment refuses to invent one, so the hire command carries `personNumber` when the
candidate is not yet a Person. A test asserts that nothing is created on the way to that refusal.

### A-5 — Offers and compensation · **IMPLEMENTED**

`proposed_compensation` is a JSON map stored as authored, published unchanged and never read by any
rule in the module. No payroll, salary-structure or statutory calculation exists here. An offer is
versioned rather than edited, at most one version is live at a time (partial unique index), and the
update mapping deliberately excludes the terms — so an accepted offer stays historically
reconstructable.

### A-6 — Interviewers · **IMPLEMENTED**

Interviewers are employment identifiers. There is no second interviewer entity and no copy of an
employee's name. Every identifier on a panel is verified through Employment's published read, under a
grant, before the interview is scheduled — which is also the tenant check.

### A-7 — Aggregate boundaries · **IMPLEMENTED**

Six aggregates and eleven tables. There is **no** talent-pool table (a pool is a tag on a candidate),
**no** pipeline table (a pipeline is a projection over applications), and **no** interviewer entity.
Profile entries, decisions and pipeline events are child records of their aggregate, not aggregates.

### A-8 — Numbering · **IMPLEMENTED**

`recruitment_number_sequence`, tenant-scoped, transactional, allocated by a single
`insert … on conflict do update … returning`. Employment's counter is not reused; no PostgreSQL global
sequence is used. A generic kernel counter was **not** extracted — recorded as debt **D-1**.

**Proved by** an integration test in which three concurrent allocations return three distinct numbers,
and a tenant-isolation test in which two tenants each get `REQ-2026-000001`.

### A-9 — Privacy, data lifecycle and search · **IMPLEMENTED, with a measured limitation**

Anonymization is a separately permissioned, irreversible operation that **deletes nothing**: the
candidate row survives with the name, address and telephone number replaced, so applications,
interviews and offers still resolve and the audit trail still reads. No retention period is invented.
Row-level security was not weakened and no database-level shortcut was introduced.

The search limitation was measured rather than assumed — see §4.

---

## 3. Kernel ports: what is real and what is not

| Port | Status |
| --- | --- |
| `ApprovalPort` | **Deliberately not consumed.** An auto-approving adapter is not evidence a human approved headcount spending (ADR-0045) |
| `NotificationPort` | **CONTRACT AVAILABLE, not consumed.** The contract addresses a *workforce user*; a candidate is not a user of this product, and an interviewer is an employment, which carries no user identity. Addressing either would mean widening the cross-module contract to resolve people into login accounts, for an adapter that records rather than sends. Recruitment raises domain events instead; Communications (Phase 17) subscribes when it can address a recipient. **Candidate and interviewer notification does not work today, and nothing in this phase claims it does.** |
| `DocumentPort` | **CONTRACT AVAILABLE, not consumed.** A résumé or offer letter is a validated *reference*; Recruitment stores no bytes. Document management is Phase 4.1's |

No duplicate notification or document infrastructure was built.

---

## 4. Performance, measured

`node scripts/measure-recruitment-performance.mjs` seeds one tenant with **100,000 candidates,
250,000 applications and 10,000 vacancies**, then measures each read **as the unprivileged application
role, under row-level security** — measuring as a superuser would measure a query nobody executes.
Median of five runs, on the development database:

| Query | Median |
| --- | --- |
| Candidate by email (indexed) | **1.0 ms** |
| Candidate by telephone (indexed) | **0.5 ms** |
| Candidate page by number | **1.0 ms** |
| **Candidate name search (`ilike`)** | **109.5 ms** |
| Pipeline board for one vacancy (aggregate) | **0.5 ms** |
| Applications for one candidate | **9.8 ms** |
| Unfinished hires (partial index) | **0.5 ms** |
| Application page by status | **27.3 ms** |

**The name search is a sequential scan, and this is the documented cause.** `explain (analyze)` shows
the row-level security predicate applied as a one-time filter and then a `Seq Scan` over the tenant's
candidates, removing 99,989 rows. `ilike` is not leakproof, so PostgreSQL will not evaluate a trigram
index *ahead of* the security qualifier; the policy runs first and the pattern match runs over what
survives.

At 100,000 candidates it costs about 110 ms and grows linearly. It was **not** fixed by weakening
isolation, and no claim is made that a sub-100 ms target was achieved for this query. The future
solution — a tenant-scoped, security-barrier-compatible search structure, or a search projection
maintained outside the policy — is recorded as debt **D-2**.

Everything else is at or below single-digit-to-low-tens milliseconds at the target volumes, including
the pipeline board, which is an aggregate query rather than a load.

---

## 5. Quality gates

```
pnpm verify   →   standards · format:check · lint · typecheck · test · build
```

| Gate | Result |
| --- | --- |
| `check-standards` | **no violations** — file budgets, naming, no `TODO`, no `eslint-disable`, no `@ts-ignore` |
| `check-architecture` | **48 models checked, no violations** |
| `check-localization` | **6 catalogue sets complete** — every key present in `en` and `ar` |
| `check-dependencies` | **510 source files, no cycles, no unused dependencies, no unreachable files** |
| `format:check` | clean |
| `lint` | clean across every package |
| `typecheck` | clean across every package |
| `test` | **954 passing** (recruitment 69, API 85, and the rest of the repository unchanged) |
| `build` | clean, including the admin portal |

---

## 6. Production completeness

No mock data, no stub API, no fake repository, no hardcoded response, no simulated approval, no fake
candidate conversion, no fake notification, no fake document, and no `TODO` implementation exists in
this phase's code. The in-memory stores and the three cross-module fakes are **test infrastructure**,
exported under names that say so and used only by suites.

Three things do not work today, and each is stated rather than approximated:

1. **Every business endpoint returns 401** until Platform's authentication adapter is supplied. This
   repository authenticates nobody by design (ADR-0032), which is why the admin screen fails closed
   into its empty state.
2. **No notification reaches a candidate or an interviewer** (§3).
3. **No document is stored** (§3).

---

## 7. Technical debt this phase records

| | Item | Why it was not done here |
| --- | --- | --- |
| **D-1** | A reusable tenant-scoped counter in the kernel | Recruitment is the second consumer, which is the moment to *consider* extracting it — not to do it inside a business phase (A-8). Employment's report recorded the same item |
| **D-2** | Candidate name search is a sequential scan under RLS | Measured, cause documented (§4). Fixing it means a search structure the policy can use, or a projection outside it — an architectural change, not a Phase 6 tweak |
| **D-3** | `row-writer.ts` is a near-copy of Employment's | Hoisting it into `@work/persistence` changes a package every phase depends on |
| **D-4** | Candidate import is resumable but not atomic | Same limitation Employment's import carries; background jobs are Phase 24's |
| **D-5** | Offer expiry is a command, not a schedule | Nothing sweeps expired offers; `recruitment.close-offer` with `expired` is the operation a scheduler will call |

## 8. Architectural follow-up

| | Item |
| --- | --- |
| **F-1** | **Phase 5's cross-module authorization.** Creating an employment directly still requires the caller to hold `people.person.read`, because Employment's composition inherits People's permission check. ADR-0043 now provides the mechanism to bound it, and Employment's `PersonDirectory` adapter could adopt it with no change to Employment's use cases. Deliberately **not** done in Phase 6: the approved decision was explicit that Phase 5 must not be modified to resolve it here. Raised as its own change, with its own review |

---

## 9. What Phase 6 does not include

Onboarding, attendance, leave, compensation, payroll, benefits, performance, learning, career
development, offboarding, workforce relations, full document management, loans, health claims, country
packs, government integrations, mobile and AI are all untouched. There is no candidate portal, no
public careers page and no candidate self-service authentication, as scoped.

---

## 10. Verdict

Phase 6 is complete against its approved decisions. The Recruitment domain is implemented end to end —
schema, domain, application services, persistence, API, portal screen, documentation and tests — with
every quality gate passing, the cross-module authorization boundary the phase turned on solved by a
mechanism now available to every later phase, and the two limitations it could not remove (a
non-atomic hire and a sequential candidate name search) made visible, measured and recoverable rather
than hidden.
