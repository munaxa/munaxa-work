# 09_PHASE_8_ATTENDANCE.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 8 – Attendance & Time Management

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Attendance & Time Management Domain.

Attendance owns time recording.

Attendance owns work schedules.

Attendance owns shifts.

Attendance does NOT own payroll.

Attendance does NOT own leave.

Attendance does NOT own employment.

Attendance provides operational work time information to future domains.

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

before implementation.

---

# Objectives

Implement enterprise attendance.

Implement work schedules.

Implement shift management.

Implement attendance events.

Implement attendance corrections.

Implement overtime calculation foundation.

Implement attendance exceptions.

Implement attendance approvals.

Implement reporting.

---

# Non Goals

Do NOT implement

Payroll calculations

Leave balances

Performance

Scheduling optimization

Workforce planning

Workflow engine

Notification engine

These consume Attendance.

---

# Business Vision

Attendance measures working time.

Attendance records facts.

Payroll interprets those facts.

Leave explains absences.

Attendance remains the system of record for work time.

---

# Scope

Attendance Event

Attendance Record

Work Day

Shift

Shift Rotation

Schedule

Schedule Assignment

Calendar Assignment

Attendance Exception

Attendance Adjustment

Attendance Approval

Attendance Summary

Time Source

Audit

History

Search

Import

Export

REST API

Administration UI

Testing

Documentation

---

# Mandatory Architecture Decisions

## AD-001

Attendance references Employment.

Attendance never references Person directly.

---

## AD-002

Attendance records events.

Attendance summaries are projections.

---

## AD-003

One Attendance Record is generated from one or more Attendance Events.

---

## AD-004

Attendance supports multiple time sources.

Examples

Biometric

Mobile

Web

Manual

API

Import

Future integrations

No source is hardcoded.

---

## AD-005

Schedules are independent from shifts.

Assignments connect Employments to schedules.

---

## AD-006

Attendance never stores payroll values.

---

## AD-007

Attendance never stores leave balances.

---

## AD-008

Attendance supports

Audit

Soft Delete

Optimistic Concurrency

Metadata

---

# Aggregate Roots

AttendanceEvent

AttendanceRecord

Shift

ShiftRotation

Schedule

ScheduleAssignment

AttendanceException

AttendanceAdjustment

AttendanceApproval

AttendanceSummaryProjection

---

# Ubiquitous Language

Attendance Event

A raw time event.

Attendance Record

The calculated workday.

Shift

Expected working hours.

Schedule

Collection of shifts.

Exception

Deviation from the expected schedule.

Adjustment

Authorized correction.

Time Source

Origin of an attendance event.

---

# Domain Principles

Raw events are immutable.

Attendance Records are derived.

Payroll consumes Attendance.

Leave consumes Attendance.

Attendance owns work time only.

---

# Attendance Lifecycle

Scheduled

↓

Clock In

↓

Clock Out

↓

Calculated

↓

Reviewed

↓

Approved (if required)

↓

Final

Corrections create new versions.

History is preserved.

---

# Time Sources

Support

Biometric Devices

Mobile Application

Employee Portal

Manager Portal

Manual Entry

CSV Import

REST API

Future integrations

Each event records its source.

Every event additionally records

Device or client identifier

Location, where the tenant enables it for that source

The event time as reported, and the time the server received it, separately

Whether the event was captured offline and synchronized later

Clock divergence between reported and received time, flagged when it exceeds a configured
tolerance

Attendance never trusts a client clock. Divergence is data, not an error to be discarded.

---

# Mobile Attendance

Mobile is a primary capture source, not a convenience.

Support

Punch from the device, online and offline

Geofencing: permitted locations per employment, site or schedule, with configurable radius

Location capture only where the tenant enables it, only at the punch, and disclosed to the
employee. Continuous background tracking is prohibited.

Offline queue with idempotent submission and client-generated identifiers

Configurable handling of punches outside a permitted geofence: reject, accept and flag, or
accept and require approval

Biometric device unlock on the handset, protecting the session and never replacing Platform
authentication

---

# Attendance Requests

Attendance raises transactions, never direct edits, for

Missing punch correction

Manual attendance entry

Overtime request and approval, before or after the fact per configuration

Shift swap and roster change requests

Remote or off-site work declaration

Each routes through the ApprovalPort from Phase 1, carries a reason, and preserves the original
record alongside the correction.

---

# Shift Management

Support

Fixed Shift

Flexible Shift

Split Shift

Night Shift

Rotating Shift

Weekend Shift

Tenant configurable.

---

# Schedule Management

Support

Weekly schedules

Monthly schedules

Recurring schedules

Holiday calendars

Schedule assignments

Future effective dates

---

# Attendance Exceptions

Examples

Late Arrival

Early Departure

Missing Clock In

Missing Clock Out

Overtime

Undertime

Absent

Unscheduled Attendance

Holiday Work

Rest Day Work

Exceptions are configurable.

---

# Attendance Adjustments

Support

Missed Punch

Manual Correction

Manager Correction

HR Correction

Bulk Corrections

Every adjustment requires

Reason

Actor

Audit

History

---

# Search

Support

Attendance Search

Shift Search

Schedule Search

Exception Search

Employee Attendance Search

Advanced Search

---

# High-Level Model

Employment

↓

Schedule Assignment

↓

Schedule

↓

Shift

↓

Attendance Events

↓

Attendance Record

↓

Attendance Summary Projection

---

# Future Consumers

Leave

Payroll

Performance

Reporting

Analytics

AI

Workflow

Notifications

Attendance exposes public contracts only.