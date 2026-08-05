# 06C_PHASE_5_3_ASSETS_CUSTODY.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 5.3 – Assets & Custody

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Assets Domain.

Assets owns the company property issued to employees, its custody, its condition and its return.

It is not a fixed-asset register and not an accounting system. Finance owns asset value and
depreciation; this domain owns who holds what, since when, and in what condition.

Custody is what makes offboarding clearance possible. Without it, an exit checklist has nothing
to check.

---

# Prerequisites

Phases 0 through 5, plus Phase 4.1.

---

# Objectives

Maintain an asset catalogue and inventory.

Assign custody to an employment and track handover.

Record acknowledgement of receipt and of liability.

Track condition, loss, damage and replacement.

Support return, clearance and deduction on non-return.

Feed Onboarding provisioning and Offboarding clearance.

---

# Non Goals

Do NOT implement

Fixed asset accounting, depreciation or procurement.

Payroll deduction — Payroll applies an authorized instruction.

Document storage — Documents owns files; this domain references them.

---

# Mandatory Architecture Decisions

## AD-001

Assets reference Employment for custody. Never Person directly.

## AD-002

Asset categories, custody rules and acknowledgement requirements are tenant configurable.

## AD-003

Custody history is immutable. Every handover, return and transfer is a new record.

## AD-004

An asset is in the custody of at most one employment at any instant. Overlapping custody is an
invariant violation, not a validation warning.

## AD-005

Non-return produces an authorized deduction instruction for Payroll on approval. This domain
never computes payroll.

## AD-006

Offboarding clearance reads custody through public contracts. Clearance cannot complete while
custody is outstanding, unless explicitly waived with a reason and an approval.

## AD-007

Supports Audit, Soft Delete, Optimistic Concurrency, Effective Dating and Metadata.

---

# Domain model

**AssetCategory** — code, name, acknowledgement requirement, return requirement, valuation
basis for deduction, condition scale.

**Asset** — category, identifier, serial number, description, status, location, purchase
reference, documents.

**CustodyAssignment** — asset, employment, issued date, expected return, acknowledgement,
condition at issue, condition at return, actual return date. Invariant: no overlapping open
assignments for one asset.

**CustodyTransfer** — direct handover between employments.

**AssetIncident** — loss, damage, theft; assessment, liability decision, authorized deduction.

**ClearanceItem** — the projection Offboarding consumes.

---

# Lifecycle

Asset: Registered → Available → Issued → In Custody → Returned → Under Repair → Retired.

Custody: Assigned → Acknowledged → Active → Return Requested → Returned → Closed, or →
Outstanding → Deduction Authorized → Written Off.

---

# Domain events

`AssetIssued`, `CustodyAcknowledged`, `AssetReturned`, `CustodyTransferred`, `AssetLost`,
`AssetDamaged`, `CustodyOutstanding`, `DeductionAuthorized`.

Consumers: Onboarding, Offboarding, Payroll, Letters, Workflow, Workforce Intelligence.

---

# Acceptance criteria

✓ One asset, one custodian, enforced as an invariant

✓ Custody history immutable and complete

✓ Employees see their own custody in self-service and acknowledge receipt there

✓ Clearance blocked by outstanding custody unless waived with approval

✓ Deductions reach Payroll only as authorized instructions

✓ Quality gates pass

---

# Definition of Done

Every item a company issues is traceable to a person and a date, and offboarding clearance is
computed rather than remembered.
