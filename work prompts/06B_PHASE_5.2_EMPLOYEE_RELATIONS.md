# 06B_PHASE_5_2_EMPLOYEE_RELATIONS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 5.2 – Employee Relations & Disciplinary

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Employee Relations Domain.

Employee Relations owns violations, investigations, disciplinary actions, warnings, grievances
and appeals.

It does NOT own Performance — a performance improvement plan is a development instrument and
belongs to Performance. It does NOT own Employment — it recommends, and Employment executes any
change to the employment relationship.

This domain carries legal weight. Its records are evidence in a labor dispute, so its history is
immutable, its access is restricted, and its process is configurable to the tenant's own
disciplinary policy and to the labor law of the country pack.

---

# Prerequisites

Phases 0 through 5, plus Phases 4.1 and 5.1.

---

# Objectives

Record violations and the evidence supporting them.

Run investigations with a defensible, auditable process.

Issue disciplinary actions under a tenant-configured escalation ladder.

Track warnings, their validity period and their expiry.

Handle grievances and appeals.

Feed statutory constraints from the country pack — what an employer may lawfully deduct or
impose, and after what process.

---

# Non Goals

Do NOT implement

Employment termination — Employment owns it, on a recommendation from here.

Payroll deduction — Payroll applies an approved deduction; this domain authorizes it.

Performance improvement plans — Performance owns them.

Workflow engine — approvals route through Workflow.

---

# Mandatory Architecture Decisions

## AD-001

Employee Relations references Employment. Never Person directly.

## AD-002

Violation categories, penalty ladders, and the escalation from verbal warning through to
dismissal recommendation are tenant configurable and constrained by the country pack. Nothing
is hardcoded.

## AD-003

The record is immutable. A correction is a new, linked record with a stated reason. Nothing is
edited or deleted, including after an appeal succeeds — a successful appeal annuls, it does not
erase.

## AD-004

A disciplinary action that carries a financial penalty produces an authorized deduction
instruction for Payroll. This domain never computes payroll.

## AD-005

A disciplinary action that recommends termination produces a recommendation only. Employment
executes, through its own lifecycle and approvals.

## AD-006

Warnings expire. Validity periods are configurable, and an expired warning no longer counts
toward escalation.

## AD-007

Access is restricted independently of ordinary employee access, and every read of a
disciplinary record is audited.

## AD-008

Due process is enforced structurally: an action cannot be issued without the process steps its
configuration requires — notice, hearing, response window and approvals.

## AD-009

Supports Audit, Soft Delete, Optimistic Concurrency, Effective Dating and Metadata.

---

# Domain model

**ViolationCategory** — code, severity, penalty ladder, statutory constraints, repeat window.

**Violation** — employment, category, occurrence date, reporter, description, evidence
attachments, state.

**Investigation** — investigator, statements, evidence, findings, recommendation, dates.

**DisciplinaryAction** — violation, action type, ladder position, penalty, effective date,
issued letter reference, acknowledgement, validity period, appeal state.

**Warning** — the issued warning, its validity window and its expiry.

**Grievance** — raiser, subject, confidentiality, handler, resolution, escalation.

**Appeal** — the challenge to an action, its reviewers and its outcome.

---

# Lifecycle

Violation Reported → Under Investigation → Findings → Pending Approval → Action Issued →
Acknowledged → Appealed → Upheld / Annulled → Expired → Archived

Grievance: Raised → Acknowledged → Under Review → Resolved → Escalated → Closed.

Every transition is audited with actor, timestamp and reason.

---

# Domain events

`ViolationRecorded`, `InvestigationOpened`, `InvestigationConcluded`, `DisciplinaryActionIssued`,
`WarningExpired`, `PenaltyAuthorized`, `TerminationRecommended`, `GrievanceRaised`,
`GrievanceResolved`, `AppealUpheld`.

Consumers: Payroll (authorized penalties), Employment (recommendations), Letters, Communications,
Workflow, GRC, Workforce Intelligence.

---

# Acceptance criteria

✓ Categories, ladders and validity periods fully configurable, constrained by country pack

✓ Due process enforced structurally, not by convention

✓ Records immutable; corrections and annulments are linked additions

✓ Penalties reach Payroll only as authorized instructions

✓ Termination is a recommendation, never an execution

✓ Access restricted and every read audited

✓ Quality gates pass

---

# Definition of Done

A tenant can operate its disciplinary policy end to end, defensibly, in both languages, with a
record that stands up in a labor dispute.
