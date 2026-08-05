# 13_PHASE_12_BENEFITS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 12 – Benefits Administration

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Benefits Administration Domain.

Benefits owns employee benefit programs.

Benefits owns eligibility.

Benefits owns enrollment.

Benefits does NOT calculate payroll.

Benefits does NOT manage compensation.

Benefits publishes approved benefit information for Payroll and other consuming domains.

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

12_PHASE_11_PAYROLL_ENGINE.md

before implementation.

---

# Objectives

Implement enterprise benefits administration.

Support benefit plans.

Support eligibility rules.

Support enrollment.

Support dependents.

Support employer contributions.

Support employee contributions.

Support providers.

Support open enrollment.

Support reporting.

---

# Non Goals

Do NOT implement

Payroll calculations

Claims processing

Medical systems

Insurance provider integrations

Accounting

These consume Benefits or integrate with it.

---

# Business Vision

Benefits define non-salary compensation provided to employees.

Benefits determine eligibility and participation.

Payroll consumes approved financial impacts only.

---

# Scope

Benefit Plan

Benefit Category

Benefit Provider

Benefit Eligibility Rule

Benefit Enrollment

Dependent

Contribution Rule

Employer Contribution

Employee Contribution

Open Enrollment Period

Benefit Adjustment

Benefit History

Benefit Summary Projection

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

Benefits reference Employment.

Never reference Person directly.

---

## AD-002

Benefit Plans are tenant configurable.

Nothing is hardcoded.

---

## AD-003

Enrollment history is immutable.

Changes create new enrollment records.

---

## AD-004

Dependents belong to Benefits.

Dependents are used for benefit eligibility.

They do not replace People or Employment.

---

## AD-005

Benefits support future effective dates.

---

## AD-006

Payroll consumes benefit contributions.

Benefits never calculate payroll.

---

## AD-007

Benefits support

Audit

Soft Delete

Optimistic Concurrency

Effective Dating

Metadata

---

# Aggregate Roots

BenefitPlan

BenefitCategory

BenefitProvider

BenefitEligibilityRule

BenefitEnrollment

Dependent

ContributionRule

BenefitAdjustment

BenefitHistory

BenefitSummaryProjection

---

# Ubiquitous Language

Benefit Plan

A benefit offered by the organization.

Benefit Category

Logical grouping of benefits.

Benefit Provider

External organization providing the benefit.

Enrollment

Employee participation in a benefit.

Dependent

Individual covered by the benefit.

Eligibility

Business rules determining participation.

Contribution

Employer or employee financial participation.

Open Enrollment

Defined period for benefit selection.

---

# Domain Principles

Benefits own benefit participation.

Compensation owns salary.

Payroll owns payroll calculations.

Employment owns employment.

One responsibility per domain.

---

# Benefit Lifecycle

Draft

↓

Published

↓

Enrollment Open

↓

Enrollment Closed

↓

Active

↓

Modified

↓

Ended

↓

Archived

Every transition is auditable.

---

# Benefit Types

Support configurable plans.

Examples

Medical Insurance

Dental Insurance

Vision Insurance

Life Insurance

Retirement Plan

Housing Benefit

Transportation Benefit

Meal Benefit

Education Assistance

Flexible Benefits

Nothing is hardcoded.

---

# Eligibility Rules

Support configurable eligibility based on

Employment Type

Employment Status

Service Length

Organization Assignment

Compensation Grade

Custom Criteria

---

# Enrollment

Support

Initial Enrollment

Open Enrollment

Mid-Year Changes

Life Events

Termination

Reinstatement

Enrollment changes are versioned.

---

# Dependents

Support

Spouse

Child

Parent

Other Eligible Dependent

Relationship rules are configurable.

---

# Contributions

Support

Employer Contribution

Employee Contribution

Percentage

Fixed Amount

Tiered Contribution

Contribution rules are configurable.

---

# Validation Rules

Validate

Employment Eligibility

Enrollment Window

Dependent Eligibility

Contribution Rules

Plan Availability

Effective Dates

Duplicate Enrollment

---

# Search

Support

Benefit Search

Enrollment Search

Dependent Search

Provider Search

Advanced Search

---

# High-Level Model

Employment

↓

Benefit Eligibility

↓

Benefit Enrollment

↓

Contribution Rules

↓

Benefit Summary Projection

Payroll consumes approved contribution data.

---

# Future Consumers

Payroll

Employee Portal

Manager Portal

Reporting

Analytics

Notifications

Benefits exposes public contracts only.