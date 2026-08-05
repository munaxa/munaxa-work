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
| Person, identity, personal data           | `people`        | Phase 4       |
| Workforce user, tenant membership          | `identity`      | Phase 2 ✅    |
| Invitation, portal access                  | `identity`      | Phase 2 ✅    |
| Employment link, delegation                | `identity`      | Phase 2 ✅    |
| Business profile, user preference          | `identity`      | Phase 2 ✅    |
| Legal entity, org unit, position, job     | `organization`  | Phase 3       |
| Employment, contract, assignment          | `employment`    | Phase 5       |
| Requisition, candidate, application       | `recruitment`   | Phase 6       |
| Onboarding journey                        | `onboarding`    | Phase 7       |
| Attendance, shift, timesheet              | `attendance`    | Phase 8       |
| Leave type, entitlement, balance, request | `leave`         | Phase 9       |
| Salary structure, grade, pay element      | `compensation`  | Phase 10      |
| Payroll run, payslip, payroll result      | `payroll`       | Phase 11      |
| Benefit plan, enrolment                   | `benefits`      | Phase 12      |
| Goal, review, rating                      | `performance`   | Phase 13      |
| Course, enrolment, certification          | `learning`      | Phase 14      |
| Career path, succession plan              | `career`        | Phase 15      |
| Approval, workflow definition, task       | `workflow`      | Phase 16      |
| Message delivery, template, notification  | `communications`| Phase 17      |
| External system integration               | `integration`   | Phase 22      |
| Document, permit, expiry                  | `documents`     | Phase 4.1     |
| Letter template, issued letter            | `letters`       | Phase 5.1     |
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

`identity` owns the *business* identity of a person: which Platform account they are, which
tenants have admitted them, and how each of those tenants presents them. It does not own the
person. Legal name, date of birth, nationality and identity documents belong to `people` in
Phase 4, and this module will not acquire them: two modules that both held a legal name would
produce two answers on a contract.

## Rules

- One concept, one owner. Never two.
- A module reads another module's data through that module's application service, public
  contracts or domain events — never its repositories or its tables.
- Reporting reads projections, never another module's transactional tables (ADR-0008).
- Changing an owner is an ADR. Ownership is never moved silently.
