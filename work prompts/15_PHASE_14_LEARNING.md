# 15_PHASE_14_LEARNING.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 14 – Learning & Development

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Learning & Development Domain.

Learning owns training.

Learning owns courses.

Learning owns learning paths.

Learning owns certifications.

Learning does NOT evaluate employee performance.

Learning does NOT determine competency.

Learning publishes learning outcomes for consuming domains.

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

13_PHASE_12_BENEFITS.md

14_PHASE_13_PERFORMANCE.md

before implementation.

---

# Objectives

Implement enterprise learning management.

Support course catalog.

Support learning paths.

Support certifications.

Support mandatory training.

Support enrollment.

Support instructor-led learning.

Support self-paced learning.

Support learning analytics.

---

# Non Goals

Do NOT implement

Performance evaluations

Promotion decisions

Succession planning

Payroll

Workflow engine

Notification engine

These consume Learning.

---

# Business Vision

Learning develops employees.

Performance measures capability.

Career & Succession evaluates readiness.

Learning provides structured development opportunities.

---

# Scope

Course

Course Category

Learning Path

Enrollment

Session

Instructor

Assessment

Certification

Mandatory Training

Learning Assignment

Learning Progress

Learning History

Learning Summary

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

Learning references Employment.

Never reference Person directly.

---

## AD-002

Course completion does not imply competency.

Performance owns competency evaluation.

---

## AD-003

Learning Paths are tenant configurable.

---

## AD-004

Courses support versioning.

Historical versions remain available.

---

## AD-005

Certifications may expire.

Recertification is supported.

---

## AD-006

Mandatory training is configurable.

No mandatory course is hardcoded.

---

## AD-007

Learning supports

Audit

Soft Delete

Optimistic Concurrency

Effective Dating

Metadata

---

# Aggregate Roots

Course

CourseCategory

LearningPath

Enrollment

Session

Instructor

Assessment

Certification

MandatoryTraining

LearningAssignment

LearningProgress

LearningHistory

LearningSummaryProjection

---

# Ubiquitous Language

Course

Structured learning content.

Learning Path

Ordered sequence of courses.

Enrollment

Participation in learning.

Session

Scheduled delivery.

Instructor

Learning facilitator.

Assessment

Evaluation of learning.

Certification

Evidence of course completion.

Mandatory Training

Training required by policy.

Learning Assignment

Training assigned to an employee.

---

# Domain Principles

Learning owns learning.

Performance owns evaluation.

Employment owns employment.

Career owns progression.

One responsibility per domain.

---

# Learning Lifecycle

Course Created

↓

Published

↓

Enrollment Open

↓

Enrollment Closed

↓

In Progress

↓

Completed

↓

Certified (if applicable)

↓

Archived

Every transition is auditable.

---

# Course Types

Support

Self-Paced

Instructor-Led

Virtual

Classroom

Blended

External

Tenant configurable.

---

# Learning Paths

Support

Role-Based Paths

Department Paths

Certification Paths

Leadership Paths

Custom Paths

---

# Assessments

Support

Quiz

Practical Assessment

Assignment

Observation

External Result

Assessments measure learning progress only.

---

# Certifications

Support

Issue Date

Expiration Date

Renewal

Recertification

History

Status

---

# Mandatory Training

Support

Compliance Training

Safety Training

Policy Training

Orientation

Role-Based Training

Recurring Training

Tenant configurable.

---

# Validation Rules

Validate

Employment Status

Enrollment Eligibility

Course Availability

Capacity

Certification Validity

Duplicate Enrollment

Learning Path Prerequisites

---

# Search

Support

Course Search

Enrollment Search

Certification Search

Learning Path Search

Advanced Search

---

# High-Level Model

Employment

↓

Learning Assignment

↓

Enrollment

↓

Course

↓

Assessment

↓

Certification

↓

Learning Summary Projection

Performance and Career consume approved learning outcomes.

---

# Future Consumers

Performance

Career & Succession

Reporting

Analytics

Employee Portal

Manager Portal

Learning exposes public contracts only.