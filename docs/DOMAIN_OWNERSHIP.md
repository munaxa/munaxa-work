# Domain ownership registry

Every business concept has exactly one owner (ADR-0004, ADR-0014). This file is that
registry. A phase that introduces a concept adds it here in the same change; a phase that
finds a concept already owned uses the owner's application service, contracts or domain
events — it never re-owns the data.

Duplicated ownership is the failure this registry exists to prevent: two modules that both
believe they own "employment status" produce two answers, and no amount of testing reconciles
them afterwards.

## Registry

| Concept                                   | Owning module   | Introduced in |
| ----------------------------------------- | --------------- | ------------- |
| Person, identity, personal data           | `people`        | Phase 4 ✅    |
| Workforce user, tenant membership          | `identity`      | Phase 2 ✅    |
| Invitation, portal access                  | `identity`      | Phase 2 ✅    |
| Employment link, delegation                | `identity`      | Phase 2 ✅    |
| Business profile, user preference          | `identity`      | Phase 2 ✅    |
| Organization unit, unit type, placement   | `organization`  | Phase 3 ✅    |
| Legal entity, country of registration     | `organization`  | Phase 3 ✅    |
| Cost centre, profit centre                | `organization`  | Phase 3 ✅    |
| Position catalogue, establishment         | `organization`  | Phase 3 ✅    |
| Organization calendar, exception days     | `organization`  | Phase 3 ✅    |
| Tenant settings (language, calendar, zone)| `organization`  | Phase 3 ✅    |
| Employment, contract, assignment, reporting line | `employment` | Phase 5 ✅  |
| Requisition, vacancy, candidate, application, interview, offer | `recruitment` | Phase 6 ✅ |
| Onboarding plan, onboarding instance, onboarding task | `onboarding` | Phase 7 ✅ |
| Attendance, time event, shift, schedule, roster | `attendance` | Phase 8 ✅ |
| Leave type, policy, entitlement, ledger, balance, request | `leave` | Phase 9 ✅ |
| Compensation plan, salary structure, grade, scale, step, component, recurring and one-time compensation | `compensation` | Phase 10 ✅ |
| Payroll group, period, run, input snapshot, result, earning and deduction line, exception, adjustment, approval decision, reconciliation, accounting line, payment instruction | `payroll` | Phase 11 ✅ |
| Benefit plan, enrolment                   | `benefits`      | Phase 12      |
| Goal, review, rating                      | `performance`   | Phase 13 ✓    |
| Course, enrolment, certification          | `learning`      | Phase 14A     |
| Career path, succession plan              | `career`        | Phase 15 ✅   |
| Approval, workflow definition, version, instance, step, decision | `workflow` | Phase 16A ✅ |
| Approval group, group membership, parallel branch, branch rule, quorum, branch condition, branch tally | `workflow` | Phase 16B ✅ |
| Service-level target, manager-routing resolution and snapshot | `workflow` | Phase 16C ✅ |
| Escalation (a person adds an approver to a stuck branch) | `workflow` | Phase 16D ✅ |
| Automatic service-level reminder, machine execution context, reminder history and its idempotency, due-reminder discovery | `workflow` | Phase 16E ✅ |
| Scheduled firing — the durable job runner that would invoke the above | — | **not owned by any module here.** `JobPort` has existed since Phase 0 and has never had an adapter; Phase 16E assigned execution to **Platform** (D-16E-03) and wrote the contract it must satisfy |
| Approval expiry as a written state, role approvers, automatic expiry action | — | not owned; deliberately unbuilt. Expiry stays **derived** (G-6 withholds an action until one is named), and no role-approver model exists |
| Message delivery, template, notification  | `communications`| Phase 17      |
| External system integration               | `integration`   | Phase 22      |
| Document type, document, document version, verification decision, access trail | `documents` | Phase 12 ✅ |
| Letter template, template version, letter request, approval decision, issued letter, reference sequence | `letters` | Phase 12 ✅ |
| Violation category, violation, investigation, case lifecycle, repeat-violation context, disciplinary ladder, issued disciplinary action, disciplinary access trail | `relations` | Phase 5.2 ✅ |
| Grievance, appeal, acknowledgement, warning expiry, evidence attachment | — | not owned; **deliberately unbuilt** by Phase 5.2. Grievance is blocked on self-service routing (`read-own` is unimplementable under ADR-0032, D-5.2-13); evidence is deferred to a Documents contract (D-5.2-08); expiry stays **derived**, as it does for approvals above |
| Asset category, asset (inventory item, in-service status) | `assets` | Phase 5.3 · Checkpoint 1 ✅ |
| Custody period (issue, return, current holder, custody history) | `assets` | Phase 5.3 · Checkpoint 2 ✅ |
| Custody ageing, outstanding-custody reporting | `assets` | Phase 5.3 · Checkpoint 3 ✅ — **derived, never persisted**. Elapsed days are computed from `issued_on` and `returned_on` against an explicit `asAt`; no `days_outstanding`, `age` or `outstanding` column exists (ADR-0070). The tenant read is an **aggregate carrying no identifier** — there is still no tenant-wide custody listing. Ageing is elapsed time, **not overdue**: no expected-return date is owned by any module |
| Custody transfer, acknowledgement, cancellation, correction, asset incident, liability, waiver, clearance projection | — | not owned yet; `assets` will own them in Phase 5.3 Checkpoint 4 and beyond. **Deliberately unbuilt**: transfer needs D-5.3-08, correction D-5.3-10, the condition scale D-5.3-05, and the clearance projection D-5.3-03 if a deduction is in scope. `issued`, `in_custody` and `returned` are **not** asset statuses — the current holder is derived from the open custody row (ADR-0070, D-5.2-16). **No module owns "what happens to custody when an employment ends"** — D-5.3-01 is open, and D-5.3-11 settled only that Assets is *asked* and never subscribes to Employment |
| Loan, advance, repayment schedule         | `loans`         | Phase 10.1    |
| Statutory rule, country pack, end of service | `statutory`  | Phase 11.1    |
| Offboarding case, clearance, settlement request | `offboarding` | Phase 11.2 |
| Claim, adjudication, entitlement balance  | `claims`        | Phase 12.1    |
| Survey, response, engagement score        | `engagement`    | Phase 13.1    |

The table is the intent recorded by the phase specifications. Rows become real as their phase
lands — marked ✅ — and the owning module is the one that holds the concept's persistence,
business rules and domain events.

`organization` owns the enterprise's *structure* and nothing else. It holds no person, no
employee count, no manager and no assignment (AD-001, AD-002): Employment references structure,
and structure never references Employment. The one number that looks like a headcount — the
establishment's *budgeted* figure — is a budget, and the *filled* count beside it is supplied by
Employment's assignment events through a port, never counted here.

The country an employment is governed by is `organization`'s, on the legal entity, and never the
tenant's (ADR-0035, 00B). Tenant settings — language, calendar, time zone, numerals, invitation
validity — are `organization`'s too, consumed by `identity` through the port it already had
(ADR-0036).

`identity` owns the *business* identity of a person: which Platform account they are, which
tenants have admitted them, and how each of those tenants presents them. It does not own the
person. Legal name, date of birth, nationality and identity documents belong to `people`, and this
module did not acquire them: two modules that both held a legal name would produce two answers on a
contract. `business_profile.display_name` is how a tenant *presents* somebody; it is not their name,
and Phase 4 changed nothing in `identity` to keep that true.

`people` owns one permanent human identity per human being, and everything about *who somebody is*:
their names over time, their government identifiers, their citizenships, how they are reached, where
they live, who to call in an emergency, what they can do, and what they did before they arrived. It
owns no employment, no assignment, no organizational placement, no salary and no attendance
(AD-002 to AD-005). Employment references Person; Person references nothing downstream of it.

Two boundaries inside `people` are worth naming because they look like near-misses:

- A person's **legal name** is effective-dated and has no column on `person` (ADR-0037). Later
  phases resolve it through the contract with an `asOf`, never by reading a field.
- A person's **application preferences** — language, calendar, numerals, time zone — remain
  `identity`'s `user_preference`, defaulted from the tenant's settings (ADR-0036).
  `person_preference` holds the *person's* preferences: dietary requirement, uniform size, consent
  to appear in a directory photograph. Two modules holding a language preference would produce two
  answers on the first screen that read the wrong one.

`employment` owns the *relationship* between a person and this tenant's workforce, and nothing else.
It holds no identity — `person_id` is a reference, and there is no name, no date of birth and no
document anywhere in it — no organizational structure, no attendance, no leave balance, no salary and
no exit process. Its assignments reference `organization`'s units, positions and cost centres **by
identifier only**, with no cached names, because a cached name is a second answer that goes stale on
the first rename.

Three boundaries inside `employment` are worth naming because each is a near-miss:

- **Leave status is not an employment status.** An employee on annual leave is employed. `leave`
  (Phase 9) owns leave, and an `on_leave` status here would be a second answer to a question that
  domain already answers (ADR-0040).
- **A manager is an employment, not a person and not a separate identity.** "Who was this person's
  manager in March" survives both of them changing jobs only if the reference is to the job.
- **Work location has no owner yet.** A unit and a physical place of work are different concepts, and
  this product models only the first. Employment does not stand one in for the other (ADR-0041).

The *filled* headcount `organization` reports now comes from Employment's assignments through the
port Phase 3 declared for it. Organization still counts nothing itself (AD-002).

A person's **nationality is an input to statutory rules and never a business rule in itself** (00B).
Nothing in `people` branches on a country code, and a person's country of *employment* comes from
their legal entity (ADR-0035), never from their passport.

**A document's expiry belongs to whoever owns the thing that expires.** Where a document evidences a
`person_identifier`, People owns the date and `documents` stores none of its own — a check
constraint refuses a row carrying both, and the view reports People's date and says whose it is.
There is exactly one authoritative answer to when a passport expires, and duplicating it into a
generic document record would produce two that could disagree. A document with no identifier behind
it — a signed policy acknowledgement, a training certificate — carries its own expiry, because
nothing else owns one.

**`documents` holds no file content and `letters` renders none.** `storage_reference` is an opaque
key this module never resolves; an issued letter carries its frozen substituted values and no
artefact. Both are missing dependencies rather than deferred features, and both are named in
[`verification/phase-12-report.md`](verification/phase-12-report.md) §5.

**`workflow` owns process and owns no business data.** It routes a decision about a subject it
identifies by two opaque strings and never interprets, so there is no foreign key out of the module
and no shape in which it could learn what a requisition is. Phase 16B added the **approval group** —
and an approval group is an explicit list of memberships a tenant writes down, not a directory. This
product owns no role directory and no group directory: nothing resolves a department, an
organizational unit, a position or a membership query into a set of approvers, and a membership on a
list is Identity's identifier held as an opaque value with no join behind it.

A **delegation** is `identity`'s and stays there: Workflow asks whether one is in force at the
instant a decision is made and stores none of its own.

Phase 16C added two things to that picture and neither moved a fact across a boundary. A
**service-level target** is wholly Workflow's: a whole number of hours or days on a step, and a state
derived from it on every read and stored nowhere. **Manager routing** is Workflow's *orchestration
only* — the reporting line remains `employment`'s and which member holds an employment remains
`identity`'s, and Workflow asks each of them one bounded question, composes the answers, and copies
the result onto the step. It caches nothing, joins nothing and re-reads nothing once an approval is
running. It is still **not a directory**: the two Identity queries take one identifier and return one
answer, `identity.membership.read` was not granted, and nothing enumerates memberships, resolves a
role or traverses more than a single level.

Phase 16D added one capability and, again, moved no fact across a boundary. **Escalation is wholly
Workflow's**: adding an approver to a running approval is an act on Workflow's own steps, recorded in
Workflow's own history, and nothing about it is another module's to know. The one fact it needs that
Workflow does not own is **whether a membership may act at all**, and that stays `identity`'s — asked
through a bounded port that takes one identifier and returns one boolean, under
`identity.membership.read` held by no user and reached only through a service grant (ADR-0043).
Identity applies its own rule and Workflow receives the answer, so there is exactly one definition of
an acting membership and it lives where the field does. This is still **not a directory**: nothing
enumerates memberships, and no candidate list exists.

**Scheduled firing, approval expiry as a written state, automatic escalation and role approvers are
owned by nobody**, because no module implements them — the row above records that as an absence rather than
leaving a reader to infer an owner. The kernel's `JobPort` is a contract with no adapter anywhere, and
no phase yet owns a durable runner for it.

## Rules

- One concept, one owner. Never two.
- A module reads another module's data through that module's application service, public
  contracts or domain events — never its repositories or its tables.
- Reporting reads projections, never another module's transactional tables (ADR-0008).
- Changing an owner is an ADR. Ownership is never moved silently.
