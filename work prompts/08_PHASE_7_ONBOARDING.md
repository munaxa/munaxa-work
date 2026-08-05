# 08_PHASE_7_ONBOARDING.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 7 – Onboarding

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Onboarding Domain.

Onboarding orchestrates the transition from Candidate to Employee.

Onboarding does not own Person.

Onboarding does not own Employment.

Onboarding coordinates other domains.

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

before implementation.

---

# Objectives

Implement the onboarding process.

Coordinate the creation or linking of a Person.

Coordinate Employment creation.

Coordinate Workforce Identity linking.

Track onboarding progress.

Support configurable onboarding templates.

Support approvals.

Support reporting.

---

# Non Goals

Do NOT implement

Recruitment

Employment

Attendance

Leave

Payroll

Performance

Learning

Workflow Engine

Notification Engine

These domains are consumed by Onboarding.

---

# Business Vision

Onboarding is the bridge between recruitment and employment.

It prepares a successful candidate to become an active employee.

It coordinates work across domains but owns no employee master data.

---

# Scope

Onboarding Case

Onboarding Template

Onboarding Task

Task Assignment

Progress Tracking

Approval Steps

Candidate Handover

Person Linking

Employment Creation Request

Portal Provisioning Request

Reporting

Audit

History

REST API

Administration UI

Testing

Documentation

---

# Mandatory Architecture Decisions

## AD-001

Onboarding is an orchestration domain.

It coordinates.

It does not own Person.

It does not own Employment.

---

## AD-002

Onboarding creates a Person only through the People Application Service.

It never writes directly to People tables.

---

## AD-003

Onboarding creates Employment only through the Employment Application Service.

It never writes directly to Employment tables.

---

## AD-004

Onboarding links Workforce Identity through public application services only.

---

## AD-005

Onboarding Templates are tenant configurable.

Tasks are never hardcoded.

---

## AD-006

Every onboarding task supports

Status

Owner

Due Date

Completion Date

Comments

Audit

---

## AD-007

Onboarding supports

Soft Delete

Audit

Optimistic Concurrency

Metadata

---

# Aggregate Roots

OnboardingCase

OnboardingTemplate

OnboardingTask

TaskAssignment

ApprovalStep

ProgressTracker

---

# Ubiquitous Language

Onboarding Case

A single onboarding process for a hired candidate.

Onboarding Template

Reusable definition of onboarding activities.

Task

A unit of work required before employment activation.

Progress

Current completion state.

Approval

Business approval required during onboarding.

Handover

Transfer from Recruitment to Onboarding.

---

# Domain Principles

Onboarding coordinates.

People owns identity.

Employment owns employment.

Workforce Identity owns business identity.

No duplication of ownership.

---

# Onboarding Lifecycle

Offer Accepted

↓

Onboarding Created

↓

Person Created or Linked

↓

Employment Created

↓

Portal Access Provisioned

↓

Tasks Completed

↓

Approvals Completed

↓

Ready for First Working Day

↓

Completed

Every stage is auditable.

---

# High-Level Model

Recruitment

↓

Onboarding Case

↓

People

↓

Employment

↓

Workforce Identity

↓

Employee Ready

---

# Templates

Support reusable onboarding templates.

Examples

Corporate Employee

Manager

Executive

Remote Worker

Contractor

Templates are configurable by Tenant.

---

# Tasks

Examples

Verify documents

Collect employee information

Assign onboarding checklist

Provision employee portal

Schedule orientation

Request approvals

Tasks remain configurable.

---

# Search

Support

Onboarding Search

Task Search

Template Search

Progress Search

Candidate Search

Advanced Search

---

# Future Consumers

Attendance

Leave

Payroll

Benefits

Performance

Learning

Reporting

Analytics

Workflow

Notifications

Onboarding exposes public contracts only.