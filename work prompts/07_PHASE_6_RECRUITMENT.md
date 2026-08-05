# 07_PHASE_6_RECRUITMENT.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 6 – Recruitment & Talent Acquisition

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Recruitment Domain.

Recruitment manages candidates.

Recruitment does NOT manage employees.

Recruitment does NOT create Employment directly.

Recruitment manages the hiring process only.

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

before implementation.

---

# Objectives

Implement the recruitment lifecycle.

Support job requisitions.

Support vacancies.

Support candidates.

Support interview workflows.

Support offer management.

Support hiring.

Support reporting.

Support integrations with future onboarding.

---

# Non Goals

Do NOT implement

Onboarding

Employment

Attendance

Leave

Payroll

Performance

Learning

Workflow Engine

These consume Recruitment outcomes.

---

# Business Vision

Recruitment finds talent.

Employment manages workers.

Candidates are not employees.

Candidates become employees only after successful hiring and onboarding.

---

# Scope

Job Requisition

Vacancy

Candidate

Candidate Profile

Application

Interview

Interview Feedback

Offer

Hiring Decision

Talent Pool

Recruitment Pipeline

Recruitment Search

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

Candidate is a separate aggregate from Person.

A candidate is not automatically a Person.

---

## AD-002

Hiring creates or links a Person.

If the candidate already exists as a Person, reuse the existing Person.

If not, create a new Person.

Duplicate prevention is mandatory.

---

## AD-003

Recruitment never creates Employment directly.

Recruitment hands the successful candidate to the Onboarding domain.

Onboarding creates Employment.

---

## AD-004

Job Requisitions belong to the Organization structure.

They reference Positions defined by the Organization Domain.

---

## AD-005

Interview stages are configurable by Tenant.

No recruitment workflow is hardcoded.

---

## AD-006

Offers belong to Recruitment.

Employment Contracts belong to Employment.

Never merge these concepts.

---

## AD-007

Recruitment supports

Audit

Soft Delete

Effective Dating where applicable

Optimistic Concurrency

Metadata

---

# Aggregate Roots

JobRequisition

Vacancy

Candidate

Application

Interview

InterviewFeedback

Offer

TalentPool

RecruitmentPipeline

---

# Ubiquitous Language

Candidate

A person applying for employment.

Application

A candidate's submission for a vacancy.

Job Requisition

Internal approval to hire.

Vacancy

An open position accepting applications.

Offer

A proposed employment package.

Hiring Decision

The final recruitment outcome.

Talent Pool

Candidates retained for future opportunities.

---

# Domain Principles

Candidates are external.

People are internal identities.

Employment begins after onboarding.

Recruitment owns hiring activities.

One domain owns one responsibility.

---

# Recruitment Lifecycle

Job Requisition

↓

Approval

↓

Vacancy Published

↓

Applications Received

↓

Screening

↓

Interviews

↓

Assessment

↓

Offer

↓

Accepted

↓

Hand Off To Onboarding

↓

Closed

Every stage is auditable.

---

# High-Level Model

Organization

↓

Job Requisition

↓

Vacancy

↓

Candidate

↓

Application

↓

Interview

↓

Offer

↓

Onboarding

↓

Person

↓

Employment

Recruitment ends when onboarding begins.

---

# Search

Support

Candidate Search

Vacancy Search

Skills Search

Experience Search

Education Search

Pipeline Search

Advanced Search

Saved Searches (future)

---

# Future Consumers

Onboarding

Reporting

Analytics

AI

Workflow

Notifications

Recruitment exposes public contracts only.

Future domains must not access Recruitment internals directly.