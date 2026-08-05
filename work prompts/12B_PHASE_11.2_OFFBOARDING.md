# 12B_PHASE_11_2_OFFBOARDING.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 11.2 – Offboarding & Final Settlement

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Offboarding Domain.

Offboarding is the mirror of Onboarding: an orchestration domain that owns no master data. It
coordinates the exit of an employee across every domain that holds something belonging to them
or to the company.

Offboarding does NOT own Employment — Employment terminates itself. It does NOT own Payroll —
Payroll computes the final settlement. It does NOT own Assets, Documents or Loans — it clears
against them.

An exit that is coordinated by a spreadsheet is how companies pay a leaver twice, or lose a
laptop, or discover an unreturned advance a year later.

---

# Prerequisites

Phases 0 through 11, plus Phases 4.1, 5.1, 5.2, 5.3 and 10.1.

---

# Objectives

Orchestrate resignation, dismissal, retirement, contract expiry and death cases.

Run configurable exit templates and checklists.

Coordinate clearance across departments.

Coordinate the final settlement.

Capture exit interviews and reasons for leaving.

Revoke access and portal provisioning.

Produce the end of service documentation.

Preserve everything for the retention period.

---

# Non Goals

Do NOT implement

Employment termination itself.

Payroll settlement calculation.

Asset, document or loan ownership.

Workflow or Notification engines.

---

# Mandatory Architecture Decisions

## AD-001

Offboarding is orchestration. It writes only through the application services of owning domains.

## AD-002

Exit templates and clearance checklists are tenant configurable, by termination reason, legal
entity and employee population.

## AD-003

Termination reason drives statutory outcome. The reason is captured once, on the Employment,
and every downstream calculation reads it from there — never a second copy.

## AD-004

Notice period, last working day and effective termination date are distinct dates, all
configurable, all governed by the country pack.

## AD-005

The final settlement is requested from Payroll and never computed here. It includes end of
service, accrued leave encashment, outstanding loans, authorized deductions and any pending
claims — each supplied by its owning domain.

## AD-006

Clearance is computed from the owning domains, not maintained as a checklist copy. An
outstanding asset or loan blocks completion unless waived with a reason and an approval.

## AD-007

Access revocation is coordinated with Workforce Identity and the Integration Hub, and is
scheduled to the effective date rather than executed on notice.

## AD-008

An exit is reversible until the effective date. Retraction restores the prior state and is
audited.

## AD-009

Exit interview responses are confidential and separately permissioned. Aggregate analysis is
available where individual attribution is not.

## AD-010

Supports Audit, Soft Delete, Optimistic Concurrency, Effective Dating and Metadata.

---

# Domain model

**OffboardingCase** — employment, reason, notice date, last working day, effective date, state,
template, owner.

**ExitTemplate** — reusable definition by reason and population.

**ClearanceItem** — a required clearance, its owning domain, its computed state, its waiver.

**ExitTask** — owner, due date, status, completion, attachments.

**ExitInterview** — questionnaire, responses, confidentiality, analysis consent.

**SettlementRequest** — the request to Payroll and the returned result reference.

**RehireEligibility** — the recorded decision and its reason.

---

# Lifecycle

Initiated → Pending Approval → Approved → Notice Period → Clearance In Progress →
Settlement Requested → Settlement Approved → Settlement Paid → Access Revoked →
Documents Issued → Completed → Archived

Retracted is available until the effective date. Every transition is audited.

---

# Domain events

`OffboardingInitiated`, `TerminationApproved`, `ClearanceCompleted`, `SettlementRequested`,
`SettlementFinalized`, `AccessRevoked`, `OffboardingCompleted`, `OffboardingRetracted`,
`RehireEligibilityRecorded`.

---

# Acceptance criteria

✓ Templates and checklists configurable by reason and population

✓ Clearance computed from owning domains, never a maintained copy

✓ Settlement requested from Payroll, including end of service, leave encashment and loan
settlement

✓ Access revoked on the effective date, not before

✓ Exit interview confidential, aggregate analysis available

✓ Retraction restores state and is audited

✓ End of service documents issued through Letters

✓ Quality gates pass

---

# Definition of Done

Every departure — voluntary or not — runs the same auditable process, clears every domain that
holds something, settles once and correctly, and leaves a complete record for the retention
period.
