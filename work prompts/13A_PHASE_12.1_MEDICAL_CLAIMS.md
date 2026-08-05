# 13A_PHASE_12_1_MEDICAL_CLAIMS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 12.1 – Medical & Employee Claims

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Claims Domain.

Claims owns employee-submitted reimbursement claims: medical, education assistance, travel,
relocation, communication, and any claim type the tenant configures.

Claims does NOT own Benefits eligibility — Benefits decides who is covered. It does NOT own
Payroll — Payroll pays an approved claim.

This is the "Financial Claims" request every competing self-service app exposes on its first
screen, and it is the most frequent reason an employee opens an HR app after checking leave.

---

# Prerequisites

Phases 0 through 12.

---

# Objectives

Tenant-configurable claim types with entitlement ceilings.

Employee submission with attachments, from web and mobile.

Approval routing and adjudication.

Coverage and entitlement checking against Benefits.

Reimbursement through Payroll, or referral to an external provider.

Claim history, balances and utilization.

---

# Non Goals

Do NOT implement

Insurance provider adjudication — the provider decides its own claims; this domain records and
routes.

Benefit plan or eligibility ownership.

Payroll calculation.

Medical records of any kind beyond the claim's supporting attachments.

---

# Mandatory Architecture Decisions

## AD-001

Claims reference Employment. Never Person directly. Dependants are referenced through Benefits.

## AD-002

Claim types are tenant configurable: eligibility, entitlement ceiling, period basis, required
attachments, approval chain, reimbursement route, proration rules.

## AD-003

Entitlement balances are projections of claim transactions, never mutable fields.

## AD-004

An approved claim produces a payment instruction for Payroll or an export for an external
provider. This domain never computes payroll.

## AD-005

Claim attachments are medical or financial evidence. They are confidential, separately
permissioned, and every access is audited.

## AD-006

Adjudication decisions are immutable. A reversal is a new linked decision with a reason.

## AD-007

Supports Audit, Soft Delete, Optimistic Concurrency, Effective Dating and Metadata.

---

# Domain model

**ClaimType** — code, category, entitlement basis, ceiling, period, coverage percentage,
required documents, approval chain, reimbursement route, dependant eligibility.

**Claim** — employment, type, claimant, beneficiary, incurred date, amount, currency,
attachments, state.

**ClaimLine** — itemized detail where the type requires it.

**Adjudication** — reviewer, decision, approved amount, deduction reason, notes.

**ClaimTransaction** — submitted, approved, rejected, paid, reversed. Append-only.

**EntitlementBalance** — projection of consumed and remaining entitlement per type and period.

---

# Lifecycle

Draft → Submitted → Under Review → Additional Information Requested → Approved / Partially
Approved / Rejected → Payment Instructed → Paid → Closed. Reversed requires elevated approval.

---

# Domain events

`ClaimSubmitted`, `ClaimAdjudicated`, `ClaimApproved`, `ClaimRejected`, `PaymentInstructed`,
`ClaimPaid`, `ClaimReversed`, `EntitlementExhausted`.

---

# Acceptance criteria

✓ Claim types and ceilings fully configurable, including dependant coverage

✓ Balances derived from transactions

✓ Partial approval supported with a stated reason

✓ Attachments confidential and access audited

✓ Approved claims reach Payroll only as instructions

✓ Employees submit and track claims from mobile, with attachments from the device camera

✓ Quality gates pass

---

# Definition of Done

An employee can submit a claim with a photographed receipt, see exactly what remains of their
entitlement, and be reimbursed in the next payroll run without HR re-keying anything.
