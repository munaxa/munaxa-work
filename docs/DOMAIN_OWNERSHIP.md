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
| Goal, review, rating                      | `performance`   | Phase 13      |
| Course, enrolment, certification          | `learning`      | Phase 14      |
| Career path, succession plan              | `career`        | Phase 15      |
| Approval, workflow definition, task       | `workflow`      | Phase 16      |
| Message delivery, template, notification  | `communications`| Phase 17      |
| External system integration               | `integration`   | Phase 22      |
| Document type, document, document version, verification decision, access trail | `documents` | Phase 12 ✅ |
| Letter template, template version, letter request, approval decision, issued letter, reference sequence | `letters` | Phase 12 ✅ |
| Violation, disciplinary action, grievance | `relations`     | Phase 5.2     |
| Asset, custody assignment                 | `assets`        | Phase 5.3     |
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

## Rules

- One concept, one owner. Never two.
- A module reads another module's data through that module's application service, public
  contracts or domain events — never its repositories or its tables.
- Reporting reads projections, never another module's transactional tables (ADR-0008).
- Changing an owner is an ADR. Ownership is never moved silently.
