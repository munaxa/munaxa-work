# 10_PHASE_9_LEAVE.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 9 – Leave & Absence Management

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Leave & Absence Management Domain.

Leave owns leave policies.

Leave owns leave balances.

Leave owns leave requests.

Leave owns leave approvals.

Leave does NOT own attendance.

Leave does NOT own payroll.

Leave explains authorized absence.

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

before implementation.

---

# Objectives

Implement enterprise leave management.

Support configurable leave policies.

Support leave balances.

Support leave accrual.

Support leave requests.

Support approval routing.

Support carry forward.

Support encashment preparation.

Support reporting.

---

# Non Goals

Do NOT implement

Payroll calculations

Attendance calculations

Workflow engine

Notification engine

Performance

Learning

Benefits

These domains consume Leave.

---

# Business Vision

Leave determines whether an employee is authorized to be absent.

Attendance records the absence.

Payroll later determines financial impact.

---

# Scope

Leave Type

Leave Policy

Leave Entitlement

Leave Balance

Accrual Rule

Carry Forward Rule

Leave Request

Leave Approval

Leave Adjustment

Holiday Calendar Reference

Leave Summary

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

Leave references Employment.

Never reference Person directly.

---

## AD-002

Leave never edits Attendance.

Attendance remains immutable.

---

## AD-003

Leave balances are owned exclusively by the Leave Domain.

No other module stores leave balances.

---

## AD-004

Leave policies are tenant configurable.

Nothing is hardcoded.

---

## AD-005

Accrual rules are configurable.

Support

Monthly

Weekly

Yearly

Service Based

Custom

---

## AD-006

Approval workflows are configurable.

Leave does not own the Workflow engine.

---

## AD-007

Leave supports

Audit

Soft Delete

Optimistic Concurrency

Metadata

Effective Dating

---

# Aggregate Roots

LeaveType

LeavePolicy

LeaveEntitlement

LeaveBalance

AccrualRule

CarryForwardRule

LeaveRequest

LeaveApproval

LeaveAdjustment

LeaveSummaryProjection

---

# Ubiquitous Language

Leave Type

Defines the category of leave.

Leave Policy

Business rules governing leave.

Entitlement

Employee eligibility.

Balance

Available leave.

Accrual

How leave is earned.

Carry Forward

Transfer unused leave.

Leave Request

Employee request for leave.

Leave Approval

Decision on a leave request.

Adjustment

Administrative modification.

---

# Domain Principles

Leave owns authorization.

Attendance owns attendance.

Payroll owns payment.

One responsibility per domain.

---

# Leave Lifecycle

Draft

↓

Submitted

↓

Pending Approval

↓

Approved

↓

Rejected

↓

Cancelled

↓

Consumed

↓

Closed

Every transition is audited.

---

# Leave Types

Support configurable leave types.

Examples

Annual Leave

Sick Leave

Emergency Leave

Maternity Leave

Paternity Leave

Marriage Leave

Bereavement Leave

Study Leave

Unpaid Leave

Compensatory Leave

Official Mission

Training Leave

Hajj Leave

Bereavement by degree of kinship, where the law or policy distinguishes them

Iddah Leave, where applicable

Hourly Leave

Nothing is hardcoded. Statutory entitlements, eligibility and limits for each type are supplied
by the country pack; the tenant configures the rest.

---

# Leave Policies

Support

Eligibility

Minimum Service

Maximum Duration

Minimum Notice

Blackout Periods

Attachment Requirements

Gender Restrictions (where legally applicable)

Carry Forward

Encashment Eligibility

Negative Balance Rules

Policies are versioned.

---

# Leave Balances

Support

Opening Balance

Accrued

Consumed

Adjusted

Expired

Carried Forward

Closing Balance

Balances are projections from leave transactions.

Balances are fractional. Accrual produces fractional days, and the balance is never silently
rounded — rounding is a configured, explicit rule applied at consumption, not at storage.

Every balance answers three questions, and the projection exposes all three

Balance as of today

Balance projected to the end of the leave year, assuming continued accrual

Balance as of any past date

The projected end-of-year balance is what an employee plans against and what a manager approves
against. It is a first-class query, not a report.

---

# Hourly Leave

Support leave measured in hours as well as days.

Hourly leave draws from the same entitlement, converted through the employment's configured
working hours.

Hourly leave has its own policies: daily and monthly limits, minimum and maximum duration,
notice, and whether it requires approval.

Attendance consumes approved hourly leave when evaluating the working day.

---

# Leave Request Attributes

A leave request carries, and the domain validates

Leave type

From and to dates, enterable and displayable in both Gregorian and Hijri

Duration, in days or hours

Reason

Attachments, where the policy requires them

Contact details during absence

Address during absence, where the policy requires it

Replacement employee, where the policy requires cover

Delegation of the requester's approval authority for the absence period, and whether the
delegation applies to all transaction types or a subset

Balance at request time, recorded on the request

The replacement and the delegation are distinct: one covers the work, the other covers the
authority. Delegation is owned by Workforce Identity and referenced here.

---

# Approval Visibility

The requester sees the full approval chain: every approver or approval committee in order,
their decision, their timestamp and their comment, and where the request currently sits.

This view is required from this phase, not from Phase 16. It consumes the ApprovalPort defined
in Phase 1.

---

# Accrual

Support

Automatic accrual

Manual accrual

Service anniversary accrual

Prorated accrual

Future-dated accrual

Accrual calculations are deterministic.

---

# Carry Forward

Support

Unlimited

Limited Days

Percentage

Expiration Date

Automatic processing

Tenant configurable.

---

# Leave Adjustments

Support

Correction

Administrative Grant

Administrative Deduction

Carry Forward Correction

Migration Adjustment

Every adjustment requires

Reason

Actor

Audit

History

---

# Validation Rules

Validate

Employment Status

Policy Eligibility

Available Balance

Requested Dates

Holiday Conflicts

Existing Leave Conflicts

Attendance Conflicts

Approval Rules

---

# Search

Support

Leave Search

Balance Search

Policy Search

Approval Queue

Advanced Search

---

# High-Level Model

Employment

↓

Leave Policy

↓

Leave Balance

↓

Leave Request

↓

Approval

↓

Leave Summary Projection

---

# Future Consumers

Attendance

Payroll

Reporting

Analytics

Workflow

Notifications

Employee Portal

Manager Portal

Leave exposes public contracts only.