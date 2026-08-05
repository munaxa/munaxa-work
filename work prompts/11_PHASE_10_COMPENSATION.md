# 11_PHASE_10_COMPENSATION.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 10 – Compensation Management

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Compensation Management Domain.

Compensation owns salary structures and compensation policies.

Compensation does NOT calculate payroll.

Compensation does NOT generate payslips.

Compensation provides compensation information to Payroll.

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

before implementation.

---

# Objectives

Implement enterprise compensation management.

Support salary structures.

Support pay grades.

Support salary scales.

Support allowances.

Support recurring earnings.

Support recurring deductions.

Support one-time compensation adjustments.

Support compensation history.

Support future payroll integration.

---

# Non Goals

Do NOT implement

Payroll calculations

Payslips

Tax calculations

Statutory deductions

Accounting

General Ledger

These belong to Payroll.

---

# Business Vision

Compensation defines what an employee is entitled to receive.

Payroll determines how much is paid during a payroll period.

---

# Scope

Compensation Plan

Salary Structure

Pay Grade

Pay Scale

Salary Step

Allowance

Deduction Definition

Recurring Compensation

One-Time Compensation

Compensation Adjustment

Compensation History

Compensation Projection

Audit

History

Import

Export

REST API

Administration UI

Testing

Documentation

---

# Mandatory Architecture Decisions

## AD-001

Compensation references Employment.

Never reference Person directly.

---

## AD-002

Compensation never performs payroll calculations.

---

## AD-003

Salary history is immutable.

Changes create new versions.

---

## AD-004

Compensation supports future effective dates.

---

## AD-005

Compensation plans are tenant configurable.

Nothing is hardcoded.

---

## AD-006

Allowances and deductions are configurable.

No earnings are hardcoded.

---

## AD-007

Compensation supports

Audit

Soft Delete

Optimistic Concurrency

Effective Dating

Metadata

---

# Aggregate Roots

CompensationPlan

SalaryStructure

PayGrade

PayScale

SalaryStep

AllowanceDefinition

DeductionDefinition

RecurringCompensation

OneTimeCompensation

CompensationAdjustment

CompensationHistory

---

# Ubiquitous Language

Compensation Plan

Defines the overall compensation model.

Salary Structure

Organizes compensation components.

Pay Grade

Employee grade.

Pay Scale

Salary range for a grade.

Salary Step

Increment within a pay scale.

Allowance

Additional earning.

Deduction Definition

Configured deduction.

Recurring Compensation

Regular compensation element.

One-Time Compensation

Single payroll-period adjustment.

Adjustment

Administrative correction.

---

# Domain Principles

Compensation owns compensation.

Payroll owns payroll.

Attendance owns work time.

Leave owns absence authorization.

No duplication of responsibility.

---

# Compensation Lifecycle

Draft

↓

Approved

↓

Effective

↓

Superseded

↓

Archived

Every change is versioned and audited.

---

# Salary Structures

Support

Fixed Salary

Graded Salary

Step-Based Salary

Band-Based Salary

Custom Structures

Tenant configurable.

---

# Allowances

Examples

Housing

Transportation

Communication

Meal

Risk

Shift

Responsibility

Custom

Nothing is hardcoded.

---

# Deductions

Examples

Loan Recovery

Union Fees

Insurance Contribution

Voluntary Savings

Charitable Donation

Custom

Statutory deductions belong to Payroll.

---

# Validation Rules

Validate

Employment Status

Effective Dates

Grade Assignment

Scale Assignment

Allowance Eligibility

Deduction Eligibility

Version Conflicts

---

# Search

Support

Compensation Search

Salary Structure Search

Grade Search

Allowance Search

Deduction Search

Advanced Search

---

# High-Level Model

Employment

↓

Compensation Plan

↓

Salary Structure

↓

Recurring Compensation

↓

Compensation Projection

Payroll consumes Compensation through public contracts.

---

# Future Consumers

Payroll

Reporting

Analytics

Employee Portal

Manager Portal

Compensation exposes public contracts only.