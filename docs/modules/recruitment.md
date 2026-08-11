# `recruitment` — the hiring process, and the people who are not yet people

**Phase 6.** Owns requisitions and their approval, vacancies, candidates, applications and their
pipeline, interviews and feedback, offers, and the transition that turns an accepted offer into a
Person and an Employment.

Owns no identity (`people`), no structure (`organization`), no employment (`employment`), no
onboarding, no compensation and no document storage.

## The distinction the whole module rests on

```text
Candidate ─── application ───► Vacancy ───► Requisition
    │                                          (authority to hire)
    └── at hire ──► Person ──► Employment
```

A **Candidate** is somebody outside the company who might join it. A **Person** is a human being on
the tenant's register. They are not the same record and they are not created at the same time: a
speculative applicant who is never contacted leaves nothing in the master registry of human identity,
because they are not one of the tenant's people ([ADR-0044](../adr/0044-a-candidate-is-not-a-person.md)).

A **Requisition** is the *authority* to hire — approved headcount, before anybody is recruited. A
**Vacancy** is the opening that accepts applications, and cannot exist without an approved
requisition. An **Application** is one candidate pursuing one vacancy, and there is exactly one per
pair: re-applying reopens the application that already exists.

## Tables

| Table | Holds |
| ----- | ----- |
| `recruitment_requisition` | The authority to hire: position, unit, headcount, status |
| `recruitment_requisition_decision` | Who approved or rejected, and what a reversal reverses |
| `recruitment_vacancy` | The opening, its channels and its dates |
| `recruitment_candidate` | Somebody who might join: name, contact, source, and nothing sensitive |
| `recruitment_candidate_profile_entry` | What they claim: skills, experience, education, certificates |
| `recruitment_application` | One candidate, one vacancy, one pursuit — including the hire state |
| `recruitment_application_event` | Every movement through the pipeline, appended |
| `recruitment_interview` | A scheduled conversation, with interviewers as employments |
| `recruitment_interview_feedback` | One verdict per interviewer, written once |
| `recruitment_offer` | What was proposed, versioned and never edited |
| `recruitment_number_sequence` | The tenant-scoped counter this module's numbers are drawn from |

All eleven are tenant-first, audited, versioned, soft-deleted and under row-level security applied by
the migration that creates them (ADR-0030). `recruitment_candidate.person_id` carries the only foreign
key that crosses a module's tables, and it points *backward*, to a module Recruitment already depends
on — the rule ADR-0042 states, not a different one.

## Decisions a reviewer should challenge

**A recruiter does not hold People's permissions.** Recruitment reaches People, Organization and
Employment through their published application services, under a **bounded service grant**: the module
holds the narrow cross-domain permission for the duration of one operation, the user is still checked
for the recruitment operation they asked for, the permitted list is explicit, grants cannot nest, and
every use is logged. [ADR-0043](../adr/0043-bounded-service-grant.md).

**Approval is a real decision by a named human.** Nothing here consults `AutoApprovingPort`: a
requisition authorizes headcount spending, and an approval nobody made is not an approval. Approving
is a separate permission from managing, a decision is never amended, and a reversal is a new row
naming the one it reverses. [ADR-0045](../adr/0045-requisition-approval-is-real.md).

**The hire is a saga, not a transaction.** The unit of work cannot span modules, so creating a Person,
creating an Employment and completing the application are separate. `hire_state` makes a half-finished
hire detectable and resumable; retrying the command is the supported recovery path; and an application
never reads `hired` without an employment behind it.
[ADR-0046](../adr/0046-the-hire-is-a-saga.md).

**An offer's compensation is opaque.** Recruitment records what a recruiter proposed and performs no
arithmetic on it — no salary structure, no payroll calculation, no statutory deduction. Storing it as
authored is also what keeps an accepted offer reconstructable after Compensation's configuration
changes.

**A renegotiated offer is a new version.** Version 1 survives, and at most one version is live at a
time: a candidate holding two open offers has two answers to which terms bind.

**Interviewers are employments.** There is no second interviewer entity and no copy of an employee's
name or contact details, which keeps "who interviewed this candidate in March" answerable after they
change roles.

**Feedback is written once and never edited.** An interviewer who could revise their score after
hearing the others is not giving an independent opinion, and a recruiter who could amend somebody
else's would make every score worthless in a dispute. No aggregate is computed: whether three fours
beat one five is a hiring policy this module has no business inventing.

## Statuses, stages and codes

The **status** sets are closed and checked in the database, because product behaviour branches on
them. What a tenant configures is the `stageCode` *within* `interviewing` — "phone screen", "panel",
"founder chat" — which is how configurable stages are honoured without shipping a workflow builder.

Everything else is a **code**: a source, a rejection reason, an interview mode, a priority. Codes are
tenant or country-pack data, validated by shape and never against a list this product ships (00B).

## Privacy and data lifecycle

This is the first module holding personal data about people who do **not** work for the customer and
never consented to a personnel system. Four things follow:

- **No government identifier, date of birth, nationality or photograph** has a column here. Those are
  People's, collected at hire from somebody who has agreed to join.
- **Anonymizing deletes nothing.** It is a separately permissioned, irreversible operation that
  replaces the name, the address and the telephone number and leaves the record: applications,
  interviews and offers still resolve, and the audit trail still reads.
- **No retention period is invented.** *When* to anonymize is a policy question a country pack and the
  future GRC phase own. This is the operation they will drive.
- **No event carries a name, an address, a résumé or a proposed salary.** Events fan out to consumers
  this module does not know and end up in logs.

## What Recruitment does not do

No candidate portal, no public careers pages and no candidate self-service authentication. No CV
parsing, no scoring, no ranking and no recommendation — every AI capability is Phase 25's, and a
shipped heuristic would be an unaccountable hiring decision. No background checks, no visa or work
permit handling, no onboarding tasks, and no document storage: a résumé or an offer letter is a
*reference* into the document store, and this module holds no bytes.

There is no notification delivery either. The kernel's contract addresses a workforce user, and
neither party Recruitment would write to is one — a candidate is not a user of this product at all,
and an interviewer is an employment, which carries no user identity. Recruitment raises the domain
events instead; Communications (Phase 17) subscribes when it can actually address a recipient.
