# 11A_PHASE_10_1_LOANS_ADVANCES.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 10.1 – Loans & Advances

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Loans Domain.

Loans owns loan products, applications, approved loans, repayment schedules and outstanding
balances.

Loans does NOT calculate payroll. It issues deduction instructions and receives confirmed
repayments back from Payroll.

An employee's loan balance is one of the few numbers they check monthly. It is a headline figure
in every competing self-service app in this market, and no phase currently owns it.

---

# Prerequisites

Phases 0 through 10.

---

# Objectives

Tenant-configurable loan and advance products.

Applications with eligibility, approval routing and disbursement.

Deterministic repayment schedules.

Salary advances against unpaid earnings.

Outstanding balance as an authoritative, auditable figure.

Settlement on termination.

Rescheduling, early settlement and suspension.

---

# Non Goals

Do NOT implement

Payroll calculation — Payroll consumes the instalment instruction.

Banking or disbursement execution — Integrations transmit; Payroll or Finance pays.

Interest as a financial product where the tenant's policy forbids it — interest is
configuration, and zero is a valid and common configuration in this market.

---

# Mandatory Architecture Decisions

## AD-001

Loans reference Employment. Never Person directly.

## AD-002

Loan products are tenant configurable: eligibility, maximum amount, maximum multiple of salary,
minimum service, instalment count, profit or interest treatment, grace period, concurrency
limits. Nothing is hardcoded.

## AD-003

Repayment schedules are deterministic and generated once at approval. Regenerating a schedule
supersedes the previous one and never edits it.

## AD-004

The outstanding balance is a projection of loan transactions, never a mutable field.

## AD-005

Payroll is the only source of confirmed repayment. A scheduled instalment becomes a repayment
only when a finalized payroll run confirms it.

## AD-006

A loan cannot be deducted below configured net-pay protection. Payroll enforces the floor and
reports the shortfall; the shortfall reschedules according to product configuration.

## AD-007

Termination triggers settlement: the outstanding balance is offset against the final settlement,
and any residue follows the tenant's configured policy.

## AD-008

Supports Audit, Soft Delete, Optimistic Concurrency, Effective Dating and Metadata.

---

# Domain model

**LoanProduct** — code, name, type, eligibility rules, limits, instalment rules, profit
treatment, guarantor requirement, concurrency rules, statutory constraints from the country
pack.

**LoanApplication** — employment, product, requested amount, requested instalments, purpose,
attachments, eligibility evaluation, approval state.

**Loan** — approved amount, disbursement, schedule, state, outstanding balance projection.

**RepaymentSchedule** — ordered instalments with due periods, amounts, state. Immutable;
superseded on reschedule.

**LoanTransaction** — disbursement, instalment due, repayment confirmed, adjustment, waiver,
settlement, write-off. Append-only.

**SalaryAdvance** — advance against earned but unpaid salary, recovered in the next run.

**Guarantor** — where the product requires one.

---

# Lifecycle

Applied → Pending Approval → Approved → Disbursed → Repaying → Suspended → Settled → Closed.

Rejected and Cancelled are terminal. Written Off requires elevated approval and is auditable.

---

# Domain events

`LoanApplied`, `LoanApproved`, `LoanDisbursed`, `InstalmentDue`, `RepaymentConfirmed`,
`LoanRescheduled`, `LoanSuspended`, `LoanSettled`, `LoanWrittenOff`, `AdvanceGranted`.

Consumers: Payroll, Compensation, Offboarding, Employee Self-Service, Workforce Intelligence,
GRC.

---

# Validation rules

Employment status and minimum service. Product eligibility. Concurrent loan limits. Maximum
exposure against salary. Net pay protection. Guarantor eligibility. Duplicate applications.
Schedule integrity — instalments must sum to the amount payable.

---

# Acceptance criteria

✓ Products fully configurable, including zero-interest

✓ Schedules deterministic and reproducible

✓ Outstanding balance derived from transactions, never stored as a mutable field

✓ Repayment recognized only from finalized payroll

✓ Net-pay protection enforced, shortfalls rescheduled by policy

✓ Termination settles the loan against the final settlement

✓ Employees see balance and schedule in self-service

✓ Golden-case tests for schedule generation and settlement

✓ Quality gates pass

---

# Definition of Done

A tenant can operate its loan and advance policy end to end, and every employee can see exactly
what they owe and when it clears.
