# 16_PHASE_15_CAREER_SUCCESSION.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 15 – Career & Succession Planning

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Career & Succession Planning Domain.

Career owns career paths.

Career owns succession planning.

Career owns talent pools.

Career does NOT own employment decisions.

Career publishes recommendations for consuming domains.

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

15_PHASE_14_LEARNING.md

before implementation.

---

# Objectives

Implement enterprise career planning.

Support career paths.

Support talent pools.

Support succession plans.

Support readiness assessments.

Support high-potential identification.

Support development plans.

Support internal mobility recommendations.

Support analytics.

---

# Non Goals

Do NOT implement

Promotions

Transfers

Salary changes

Employment modifications

Workflow engine

Notification engine

These consume Career outcomes.

---

# Business Vision

Career & Succession prepares the organization for future workforce needs.

It identifies talent and readiness.

It does not execute employment changes.

---

# Scope

Career Path

Career Stage

Career Plan

Talent Pool

Successor

Successor Candidate

Readiness Assessment

Critical Position

Development Plan

Internal Mobility Recommendation

Career Summary

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

Career references Employment.

Never reference Person directly.

---

## AD-002

Career recommendations never modify Employment.

---

## AD-003

Career Paths are tenant configurable.

---

## AD-004

Critical Positions belong to the Organization Domain.

Career references them.

---

## AD-005

Successor recommendations are advisory.

They do not trigger promotions automatically.

---

## AD-006

Development Plans reference Learning.

Learning remains the owner of training.

---

## AD-007

Career supports

Audit

Soft Delete

Optimistic Concurrency

Effective Dating

Metadata

---

# Aggregate Roots

CareerPath

CareerStage

CareerPlan

TalentPool

CriticalPositionReference

Successor

ReadinessAssessment

DevelopmentPlan

MobilityRecommendation

CareerSummaryProjection

---

# Ubiquitous Language

Career Path

Planned progression of roles.

Career Stage

Position within a career path.

Talent Pool

Group of employees with shared potential.

Critical Position

Position requiring succession planning.

Successor

Recommended replacement for a critical position.

Readiness

Preparedness for a future role.

Development Plan

Actions to improve readiness.

Mobility Recommendation

Suggested internal movement.

---

# Domain Principles

Career owns planning.

Employment owns assignments.

Performance owns evaluations.

Learning owns training.

One responsibility per domain.

---

# Career Lifecycle

Career Path Created

↓

Development Plan Assigned

↓

Learning Activities

↓

Readiness Assessment

↓

Successor Recommendation

↓

Career Plan Updated

↓

Archived

Every transition is auditable.

---

# Career Paths

Support

Technical

Management

Leadership

Executive

Specialist

Custom Paths

Tenant configurable.

---

# Talent Pools

Support

Graduate Pool

Leadership Pool

Technical Experts

Future Managers

High Potential Employees

Custom Pools

---

# Readiness Levels

Support configurable levels.

Examples

Not Ready

Ready in 1–2 Years

Ready in 6–12 Months

Ready Now

Tenant configurable.

---

# Development Plans

Support

Learning Activities

Coaching

Mentoring

Projects

Stretch Assignments

Assessments

Target Dates

Individual Development Plans are jointly owned by the employee and the manager: both contribute,
both see progress, and the plan is versioned per cycle.

Support a configurable development-mix model — experience, exposure and education, weighted
70-20-10 by default and adjustable by the tenant — so a plan can be validated for balance rather
than becoming a list of courses.

Development activities reference Learning. Learning remains the owner of training.

---

# Internal Mobility

Support recommendations for

Promotion

Lateral Move

Cross-Department Move

International Assignment

Temporary Assignment

Recommendations only.

---

# Validation Rules

Validate

Employment Status

Career Path Eligibility

Critical Position Availability

Duplicate Successor Assignments

Development Plan Integrity

---

# Search

Support

Career Path Search

Talent Pool Search

Successor Search

Critical Position Search

Advanced Search

---

# High-Level Model

Employment

↓

Performance

↓

Learning

↓

Career Plan

↓

Readiness Assessment

↓

Successor Recommendation

↓

Career Summary Projection

Employment consumes approved decisions through separate business processes.

---

# Future Consumers

Reporting

Analytics

Employee Portal

Manager Portal

AI Workforce Intelligence

Career exposes public contracts only.