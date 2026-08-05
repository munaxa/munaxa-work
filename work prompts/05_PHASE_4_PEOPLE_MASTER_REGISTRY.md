# 05_PHASE_4_PEOPLE_MASTER_REGISTRY.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 4 – People Master Registry

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the enterprise People Master Registry.

This domain owns human identity.

It does NOT own employment.

It does NOT own attendance.

It does NOT own payroll.

It does NOT own leave.

Every future workforce module references Person.

Person never references those modules.

---

# Prerequisites

Claude MUST read

00_MASTER_INSTRUCTIONS.md

01_PHASE_0_WORK_BOOTSTRAP.md

02_PHASE_1_FOUNDATION.md

02A_PHASE_1_1_ARCHITECTURE_VERIFICATION.md

03_PHASE_2_WORKFORCE_IDENTITY.md

04_PHASE_3_ORGANIZATION.md

before implementation.

---

# Objectives

Create the enterprise master registry for people.

Support one permanent identity per person.

Prevent duplicate people.

Support rehire.

Support multiple employments.

Support historical records.

Support international organizations.

Support effective dating.

Support auditing.

Support future modules.

---

# Non Goals

Do NOT implement

Employment

Contracts

Recruitment

Attendance

Leave

Payroll

Performance

Learning

Workflow

Benefits

Medical

These domains consume Person.

---

# Business Vision

A Person represents a real human being.

Business relationships change.

Identity does not.

One person may

Become an employee.

Become a manager.

Leave the company.

Return years later.

Remain the same Person.

---

# Scope

Person

Government Identifiers

Personal Information

Contact Information

Addresses

Emergency Contacts

Languages

Skills

Education

Professional Experience

Certifications

Preferences

Notes

Tags

Profile Photo

Metadata

Search

Import

Export

REST APIs

Administration UI

History

Audit

Testing

Documentation

---

# Mandatory Architecture Decisions

## AD-001

A Person is created once.

Never create duplicate people.

---

## AD-002

Employment references Person.

Person never references Employment.

---

## AD-003

Person contains no organizational information.

Forbidden fields include

Department

Company

Branch

Division

Section

Team

Position

Manager

Cost Center

Shift

Supervisor

Those belong to Employment Assignment.

---

## AD-004

Person contains no payroll information.

---

## AD-005

Person contains no attendance information.

---

## AD-006

Person supports multiple future employments.

---

## AD-007

Every Person belongs to one Tenant.

---

## AD-008

Every Person supports

Audit

Soft Delete

Optimistic Concurrency

Effective Dating

Metadata

---

## AD-009

Historical identity information is never destroyed.

---

## AD-010

Future modules consume Person through public contracts only.

---

# Aggregate Root

Person

The Person aggregate owns

Personal Information

Identifiers

Contacts

Addresses

Emergency Contacts

Languages

Skills

Education

Experience

Certifications

Preferences

Tags

Notes

Metadata

---

# Ubiquitous Language

Person

A permanent human identity.

Identifier

A government or business identifier.

Contact

A communication channel.

Address

A physical or mailing address.

Emergency Contact

A person to contact in emergencies.

Skill

A capability possessed by the person.

Certification

A formal qualification.

Experience

Professional history.

Education

Academic history.

Preference

Personal configuration.

---

# Domain Principles

Identity is permanent.

Employment is temporary.

Organization is temporary.

Assignments are temporary.

Identity never changes ownership.

One domain owns one responsibility.

---

# High-Level Model

Tenant

↓

Person

↓

Identifiers

Contacts

Addresses

Emergency Contacts

Skills

Education

Experience

Preferences

Future domains reference Person.

Person references no future domains.

---

# Duplicate Prevention

The system must detect duplicate people before creation.

Matching should support

Government ID

Passport

National Identifier

Email

Phone Number

Name + Date of Birth

Duplicate detection must execute

Before Create

Before Import

Before Synchronization

Background validation

Duplicate candidates require review.

---

# Versioning

Versioned child entities must reuse the Versioned Child Entity pattern defined in Phase 1.

Applicable entities include

Addresses

Contacts

Preferences

Emergency Contacts

Historical records remain immutable.

---

# Search

Support

Quick Search

Advanced Search

Government Identifier Search

Email Search

Phone Search

Skill Search

Certification Search

Tag Search

Incremental Search

Future AI search compatibility.

---

# Future Consumers

Employment

Recruitment

Onboarding

Attendance

Leave

Payroll

Benefits

Performance

Learning

Manager Portal

Employee Portal

Reporting

Analytics

These modules consume the People domain.

People consumes no business domains.