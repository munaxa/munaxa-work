# 14_PHASE_13_PERFORMANCE.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 13 – Performance Management

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Performance Management Domain.

Performance measures employee performance.

Performance owns goals.

Performance owns competency evaluations.

Performance owns review cycles.

Performance does NOT own salary changes.

Performance does NOT own promotions.

Performance does NOT own disciplinary actions.

Performance publishes evaluation outcomes for other domains.

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

before implementation.

---

# Objectives

Implement enterprise performance management.

Support goal management.

Support competency frameworks.

Support review cycles.

Support continuous feedback.

Support one-to-one meetings.

Support performance improvement plans.

Support calibration.

Support analytics.

---

# Non Goals

Do NOT implement

Salary changes

Promotions

Employment decisions

Payroll

Learning

Succession

Workflow engine

Notification engine

These consume Performance.

---

# Business Vision

Performance measures how employees perform.

Business decisions are made by consuming domains.

Performance remains objective.

---

# Scope

Goal

Goal Category

Objective

Key Result

Competency Framework

Competency

Review Cycle

Performance Review

Review Template

Reviewer Assignment

Self Assessment

Manager Assessment

Peer Assessment

Calibration Session

Feedback

One-to-One Meeting

Performance Improvement Plan

Performance Summary

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

Performance references Employment.

Never reference Person directly.

---

## AD-002

Goals are configurable.

No hardcoded goal structures.

---

## AD-003

Competency frameworks are tenant configurable.

---

## AD-004

Performance Reviews are immutable after completion.

Corrections create new versions.

---

## AD-005

Performance does not modify Employment.

Performance publishes recommendations only.

---

## AD-006

Performance supports multiple review methods.

Examples

Self

Manager

Peer

360°

Committee

Tenant configurable.

---

## AD-007

Performance supports

Audit

Soft Delete

Optimistic Concurrency

Effective Dating

Metadata

---

# Aggregate Roots

Goal

Objective

KeyResult

CompetencyFramework

Competency

ReviewCycle

PerformanceReview

ReviewTemplate

ReviewerAssignment

SelfAssessment

ManagerAssessment

PeerAssessment

CalibrationSession

Feedback

OneToOneMeeting

PerformanceImprovementPlan

PerformanceSummaryProjection

---

# Ubiquitous Language

Goal

Business objective assigned to an employee.

Objective

Specific target.

Key Result

Measurable outcome.

Competency

Expected capability.

Review Cycle

Scheduled evaluation period.

Performance Review

Formal evaluation.

Calibration

Cross-manager consistency review.

Feedback

Continuous performance communication.

PIP

Performance Improvement Plan.

---

# Domain Principles

Performance owns evaluation.

Compensation owns compensation.

Employment owns employment.

Learning owns training.

One responsibility per domain.

---

# Performance Lifecycle

Goal Created

↓

Goal Approved

↓

Execution

↓

Self Assessment

↓

Manager Review

↓

Peer Review (optional)

↓

Calibration

↓

Completed

↓

Archived

Every transition is auditable.

---

# Goals

Support

Corporate Goals

Department Goals

Team Goals

Individual Goals

Weighted Goals

SMART Goals

OKRs

Tenant configurable.

---

# Competencies

Support

Technical

Leadership

Behavioral

Functional

Compliance

Custom competencies

---

# Review Cycles

Support

Quarterly

Semiannual

Annual

Probation

Ad-hoc

Tenant configurable.

---

# Talent Classification

Support a configurable performance-and-potential matrix — a nine-box grid by default, with the
dimensions, axis labels, box count and box definitions all tenant configurable.

Placement is derived from performance and potential ratings, may be overridden in calibration
with a recorded reason, and is versioned per cycle.

The matrix is published to Career & Succession as a recommendation. It never modifies
Employment and never triggers a promotion.

---

# Continuous Feedback

Support

Recognition

Coaching

Constructive Feedback

Private Notes

Public Recognition (optional)

---

# One-to-One Meetings

Support

Agenda

Notes

Action Items

Follow-up

Meeting History

---

# Performance Improvement Plans

Support

Objectives

Actions

Milestones

Review Dates

Completion Status

History

---

# Validation Rules

Validate

Employment Status

Review Eligibility

Reviewer Assignment

Goal Ownership

Cycle Dates

Duplicate Reviews

Calibration Rules

---

# Search

Support

Goal Search

Review Search

Competency Search

Feedback Search

Advanced Search

---

# High-Level Model

Employment

↓

Goals

↓

Reviews

↓

Competencies

↓

Performance Summary Projection

↓

Recommendations

Compensation, Learning and Succession consume approved outcomes.

---

# Future Consumers

Compensation

Learning

Career & Succession

Reporting

Analytics

Employee Portal

Manager Portal

Performance exposes public contracts only.