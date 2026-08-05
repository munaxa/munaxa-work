# 06_PHASE_5_EMPLOYMENT.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 5 – Employment

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Employment Domain.

Employment represents the legal and business relationship between a Person and a Tenant.

Employment is NOT the Person.

Employment is NOT Attendance.

Employment is NOT Payroll.

Employment is NOT Leave.

Employment owns the workforce relationship only.

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

before implementation.

---

# Objectives

Implement the Employment Domain.

Support

Employment lifecycle

Multiple employments

Rehire

Employment contracts

Organizational assignments

Employment history

Effective dating

Audit

Future HR modules

---

# Non Goals

Do NOT implement

Recruitment

Onboarding

Attendance

Leave

Payroll

Benefits

Performance

Learning

Workflow

These domains consume Employment.

---

# Business Vision

A Person may have

No Employment

One Employment

Multiple historical Employments

Multiple concurrent Employments (future)

Employment is temporary.

Person is permanent.

---

# Scope

Employment

Employment Number

Employment Status

Employment Type

Employment Category

Employment Class

Employment Assignment

Employment Contract

Probation

Compensation Reference

Benefit Reference

Reporting Relationship

Employment Timeline

Status History

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

Employment references Person.

Person never references Employment.

---

## AD-002

Employment Number identifies an employment relationship.

It is NOT the permanent identity of the person.

---

## AD-003

Every Employment receives a unique Employment Number.

Example

EMP-2026-000001

Employment Numbers are immutable.

---

## AD-004

A Person may have multiple Employments.

The architecture must support

Historical Employments

Concurrent Employments

Future Employments

---

## AD-005

Assignments belong to Employment.

Organization is referenced through Assignments.

Employment never stores department or position directly.

---

## AD-006

Employment contains no attendance data.

---

## AD-007

Employment contains no leave balances.

---

## AD-008

Employment contains no payroll calculations.

---

## AD-009

Employment supports

Audit

Soft Delete

Effective Dating

Optimistic Concurrency

Metadata

---

## AD-010

Employment history is permanent.

Historical records are immutable.

---

# Aggregate Root

Employment

Employment owns

Contracts

Assignments

Reporting Relationships

Compensation References

Benefit References

Status History

Timeline Projection

Metadata

---

# Ubiquitous Language

Employment

The legal workforce relationship.

Assignment

Organizational placement.

Contract

Legal agreement.

Probation

Evaluation period.

Employment Status

Current lifecycle state.

Employment Number

Permanent identifier for one Employment.

Rehire

New Employment for an existing Person.

Transfer

Assignment change within an Employment.

Termination

End of an Employment.

---

# Domain Principles

Person owns identity.

Employment owns the relationship.

Organization owns structure.

Assignments connect Employment to Organization.

One responsibility per domain.

---

# High-Level Model

Tenant

↓

Person

↓

Employment

↓

Assignment

↓

Organization

Future operational modules consume Employment and Assignment.

---

# Employment Lifecycle

Draft

↓

Pending Approval

↓

Active

↓

Suspended

↓

Terminated

↓

Retired

↓

Archived

Every transition is audited.

---

# Rehire

Rehire creates

New Employment

New Employment Number

New Contracts

New Assignments

Existing Person reused.

Never recreate the Person.

---

# Future Consumers

Recruitment

Onboarding

Attendance

Leave

Payroll

Benefits

Performance

Learning

Workflow

Reporting

Employee Portal

Manager Portal

Employment becomes the workforce backbone for all future operational modules.