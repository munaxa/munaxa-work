# 04_PHASE_3_ORGANIZATION.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 3 – Organization Domain

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Organization Domain.

It defines the enterprise organizational structure.

It does NOT implement employees.

It does NOT implement employment.

It does NOT implement attendance.

It does NOT implement payroll.

Organization owns organizational entities only.

---

# Prerequisites

Claude MUST read

00_MASTER_INSTRUCTIONS.md

01_PHASE_0_WORK_BOOTSTRAP.md

02_PHASE_1_FOUNDATION.md

02A_PHASE_1_1_ARCHITECTURE_VERIFICATION.md

03_PHASE_2_WORKFORCE_IDENTITY.md

before implementation.

---

# Objectives

Implement the organizational hierarchy.

Support multiple companies.

Support legal entities.

Support unlimited organizational depth.

Support historical reorganizations.

Support effective dating.

Support enterprise reporting.

Support future HR modules.

---

# Non Goals

Do NOT implement

People

Employment

Attendance

Leave

Payroll

Recruitment

Performance

Workflow

No employee assignments.

No reporting hierarchy.

---

# Business Vision

The Organization Domain represents how the enterprise is structured.

It does not represent people.

People move.

Departments change.

Branches open and close.

The organization evolves independently from employees.

---

# Scope

Company

Legal Entity

Business Unit

Branch

Division

Department

Section

Team

Cost Center

Profit Center

Job Position Catalog

Organization Calendar

Organization Hierarchy

Organization Metadata

Organization Search

Import

Export

REST API

Administration UI

Audit

History

Testing

Documentation

---

# Mandatory Architecture Decisions

## AD-001

Organization owns structure.

Employment references structure.

Organization never references Employment.

---

## AD-002

Organization contains no employee data.

No employee counts.

No managers.

No assignments.

No attendance.

---

## AD-003

The hierarchy must support unlimited depth.

The implementation must not assume a fixed number of levels.

---

## AD-004

Every organizational entity belongs to exactly one Tenant.

---

## AD-005

Every organizational entity supports

Audit

Soft Delete

Effective Dating

Optimistic Concurrency

Metadata

---

## AD-006

Job Positions belong to Organization.

People occupy Positions through Employment Assignments.

Never assign a Person directly to a Position in this domain.

---

## AD-007

Cost Centers and Profit Centers are organizational reference data.

Financial ownership belongs to Finance integrations, not Organization.

---

# Aggregate Roots

Company

LegalEntity

BusinessUnit

Branch

Division

Department

Section

Team

CostCenter

ProfitCenter

Position

OrganizationCalendar

OrganizationHierarchy

---

# Ubiquitous Language

Company

Top-level operating company inside a Tenant.

Legal Entity

A legally registered business entity.

Business Unit

A strategic business grouping.

Branch

A physical or operational branch.

Division

A major organizational division.

Department

A functional department.

Section

A subdivision of a department.

Team

The smallest operational grouping.

Position

A reusable organizational role.

Hierarchy

The parent-child organizational structure.

---

# Domain Principles

Organization owns structure.

Employment owns assignments.

People own identity.

No domain duplicates ownership.

Historical reorganizations are preserved.

Future organizational changes must not rewrite history.

---

# High-Level Model

Tenant

↓

Company

↓

Legal Entity

↓

Business Unit

↓

Branch

↓

Division

↓

Department

↓

Section

↓

Team

Each level is configurable.

Tenants may use only the levels they require.

The hierarchy engine must not require every level to exist.

---

# Position Catalog

Positions are reusable definitions.

Examples

HR Manager

HR Officer

Payroll Specialist

Recruiter

Software Engineer

Finance Director

Operations Manager

A Position is not an employee.

Assignments connect Employments to Positions.

---

# Manpower Planning

Positions carry an approved establishment: the budgeted headcount for a position within an
organizational unit, effective dated.

Support

Budgeted headcount per position and unit

Approved, filled and vacant counts, as a projection

Establishment changes with approval and history

Recruitment requisitions validated against the establishment

Position criticality, consumed by Career & Succession

Organization owns the establishment. It never counts employees itself — filled counts are a
projection fed by Employment's assignment events.

---

# Organization Calendar

Support organizational calendars.

Examples

Corporate Calendar

Regional Calendar

Branch Calendar

Future Attendance and Leave modules consume these calendars.

Organization does not calculate attendance.

---

# Future Consumers

Employment

Recruitment

Attendance

Leave

Payroll

Performance

Learning

Reporting

Workflow

These modules consume Organization through public contracts only.

No module reads Organization internals directly.