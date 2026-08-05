# 12_PHASE_11_PAYROLL_ENGINE.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 11 – Payroll Engine

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Payroll Engine.

Payroll calculates employee compensation.

Payroll generates payslips.

Payroll creates payroll journals.

Payroll prepares payment files.

Payroll consumes data from other domains.

Payroll does not own employment, attendance, leave, or compensation.

---

# Prerequisites

Claude MUST read

00_MASTER_INSTRUCTIONS.md

01_PHASE_0_WORK_BOOTSTRAP.md

02_PHASE_1_FOUNDATION.md

02A_PHASE_1_1_ARCHITECTURE_VERIFICATION.md

03_PHASE_2_WORKFORCE_IDENTITY.md

04_PHASE_3_ORGANIZATION.md

05_PHASE_4_PEOPLE_MASTER_REGISTRY.md

06_PHASE_5_EMPLOYMENT.md

07_PHASE_6_RECRUITMENT.md

08_PHASE_7_ONBOARDING.md

09_PHASE_8_ATTENDANCE.md

10_PHASE_9_LEAVE.md

11_PHASE_10_COMPENSATION.md

before implementation.

---

# Objectives

Implement enterprise payroll processing.

Support payroll calendars.

Support payroll periods.

Support payroll runs.

Support payroll calculations.

Support retroactive payroll.

Support off-cycle payroll.

Support payslips.

Support payment file generation.

Support payroll journals.

Support audit.

---

# Non Goals

Do NOT implement

Accounting

General Ledger

Bank integrations

Government reporting

Tax engine customization

ERP synchronization

These consume Payroll outputs.

---

# Business Vision

Payroll transforms approved workforce information into financial payroll results.

Payroll is the financial interpretation of

Employment

Attendance

Leave

Compensation

Payroll never owns these domains.

---

# Scope

Payroll Calendar

Payroll Period

Payroll Run

Payroll Calculation

Payroll Result

Payroll Item

Payroll Adjustment

Retro Payroll

Off-Cycle Payroll

Payslip

Payment File

Payroll Journal

Payroll Snapshot

Payroll Audit

Payroll Summary

Import

Export

REST API

Administration UI

Testing

Documentation

---

# Mandatory Architecture Decisions

## AD-001

Payroll references Employment.

Never reference Person directly.

---

## AD-002

Payroll consumes immutable snapshots.

Payroll never recalculates using live mutable data.

---

## AD-003

Payroll calculations are deterministic.

Same inputs always produce the same outputs.

---

## AD-004

Payroll Runs are immutable after finalization.

Corrections require adjustment or rerun.

Never modify finalized payroll.

---

## AD-005

Payroll supports

Regular Payroll

Off-Cycle Payroll

Retro Payroll

Termination Payroll

Bonus Payroll

Adjustment Payroll

---

## AD-006

Payroll formulas are configurable.

No payroll calculations are hardcoded.

---

## AD-007

Payroll supports

Audit

Versioning

Optimistic Concurrency

Metadata

Complete calculation traceability.

---

# Aggregate Roots

PayrollCalendar

PayrollPeriod

PayrollRun

PayrollCalculation

PayrollResult

PayrollItem

PayrollAdjustment

RetroPayroll

OffCyclePayroll

Payslip

PaymentFile

PayrollJournal

PayrollSnapshot

PayrollSummaryProjection

---

# Ubiquitous Language

Payroll Run

Execution of payroll.

Payroll Period

Time period being processed.

Payroll Result

Final calculated outcome.

Payroll Item

Single earning or deduction.

Retro Payroll

Recalculation of previous periods.

Off-Cycle Payroll

Payroll outside regular schedule.

Snapshot

Immutable calculation inputs.

Payslip

Employee payroll statement.

Payment File

Bank payment instructions.

Journal

Accounting export.

---

# Domain Principles

Payroll owns calculations.

Compensation owns salary definitions.

Attendance owns work time.

Leave owns leave authorization.

Employment owns employment status.

Payroll consumes approved information only.

---

# Payroll Lifecycle

Draft

↓

Validation

↓

Calculation

↓

Review

↓

Approval

↓

Finalized

↓

Payment Ready

↓

Paid

↓

Closed

Every transition is audited.

---

# Payroll Inputs

Employment Snapshot

Compensation Snapshot

Attendance Snapshot

Leave Snapshot

Payroll Adjustments

Approved One-Time Payments

Configured Payroll Rules

Snapshots remain immutable.

---

# Payroll Outputs

Gross Pay

Taxable Earnings

Non-Taxable Earnings

Employer Contributions

Employee Contributions

Net Pay

Payslip

Payroll Journal

Payment File

Audit Trail

---

# Retro Payroll

Support

Prior Period Adjustments

Salary Corrections

Attendance Corrections

Leave Corrections

Retro calculations never overwrite historical payroll.

Adjustments remain traceable.

---

# Off-Cycle Payroll

Support

Bonus

Commission

Correction

Final Settlement

Emergency Payment

Independent from regular payroll.

---

# Payslips

Support

Electronic Payslips

Printable Payslips

Version History

Secure Access

Employee Portal integration

Payslips are immutable after publication.

---

# Payroll Journals

Support configurable journal mapping.

Payroll exports accounting-ready journal entries.

General Ledger posting belongs to ERP integration.

---

# Payment Files

Support configurable payment file formats.

Generation is configurable.

Bank transmission is outside this domain.

---

# Validation Rules

Validate

Employment Eligibility

Payroll Period Status

Approved Attendance

Approved Leave

Compensation Effectivity

Duplicate Payroll Runs

Formula Integrity

Snapshot Completeness

---

# Search

Support

Payroll Run Search

Employee Payroll Search

Payslip Search

Payroll Period Search

Advanced Search

---

# High-Level Model

Employment

↓

Compensation Snapshot

Attendance Snapshot

Leave Snapshot

↓

Payroll Calculation

↓

Payroll Result

↓

Payslip

↓

Payroll Journal

↓

Payment File

---

# Future Consumers

Finance Integration

ERP Integration

Employee Portal

Manager Portal

Reporting

Analytics

Government Reporting

Payroll exposes public contracts only.