# 20_PHASE_19_MANAGER_SELF_SERVICE.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 19 – Manager Self-Service (MSS)

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Manager Self-Service application.

MSS is an application layer.

MSS owns no business logic.

MSS consumes Application Services exposed by business domains.

Managers receive additional capabilities through permissions and organizational assignments.

---

# Prerequisites

Claude MUST complete all previous phases.

---

# Objectives

Build the manager-facing application.

Provide managers with operational visibility over their teams.

Reuse existing APIs.

Reuse Workflow.

Reuse Communications.

Reuse all business domains.

---

# Non Goals

Do NOT duplicate

Business logic

Workflow

Attendance calculations

Leave calculations

Payroll calculations

Performance calculations

Learning rules

MSS consumes existing services.

---

# Business Vision

Managers should be able to manage their teams without requiring HR intervention.

All actions remain governed by backend permissions and workflow rules.

---

# Functional Scope

Manager Dashboard

My Team

Organization View

Approvals

Team Attendance

Team Leave

Team Schedules

Team Performance

One-to-One Meetings

Learning Progress

Career Development

Compensation Visibility (permission-based)

Benefits Overview (permission-based)

Analytics

Tasks

Announcements

Notifications

Settings

---

# Architecture Decisions

## AD-001

Managers are Employees with additional permissions.

No Manager entity exists.

---

## AD-002

Team membership comes from Employment Assignments.

---

## AD-003

Manager visibility is determined by organizational hierarchy and permissions.

---

## AD-004

MSS consumes Application Services only.

---

## AD-005

No repository access.

No direct database access.

---

## AD-006

Every business operation is validated by backend permissions.

---

# Dashboard

Support configurable widgets.

Examples

Pending Approvals

Today's Attendance

Employees on Leave

Missing Attendance

Upcoming Reviews

Learning Compliance

Probation Status

Open Positions

Team Announcements

Widgets are tenant configurable.

---

# Team Management

Display

Direct Reports

Indirect Reports (where permitted)

Organization Tree

Employment Status

Work Location

Current Assignments

Search

Filters

---

# Approvals

Support

Leave Approval

Attendance Adjustment Approval

Compensation Approval (where permitted)

Performance Approval

Learning Approval

Workflow Tasks

All approvals use the Workflow Domain.

---

# Attendance

Display

Today's Attendance

Late Employees

Missing Punches

Overtime

Shift Coverage

Attendance Trends

Managers may approve corrections where authorized.

---

# Leave

Display

Pending Requests

Team Calendar

Leave Balances (subject to permissions)

Approval History

Coverage Planning

---

# Performance

Display

Goals

Review Cycles

Feedback

Calibration Participation

Performance Improvement Plans

One-to-One Meetings

---

# Learning

Display

Assigned Training

Mandatory Training

Completion Status

Certification Expiry

Learning Progress

---

# Career

Display

Talent Pool Membership

Development Plans

Readiness Levels

Successor Recommendations

Managers provide input only where authorized.

---

# Compensation

Permission controlled.

Display only approved information.

No compensation editing unless explicitly authorized.

---

# Analytics

Support

Headcount

Attendance Trends

Leave Trends

Performance Distribution

Learning Compliance

Turnover Indicators (future)

Managers see only authorized data.

---

# Search

Support

Team Search

Attendance Search

Leave Search

Performance Search

Learning Search

Global Search

---

# Security

Enforce

Authentication

Authorization

Tenant Isolation

Organizational Scope

Data Ownership

Secure Downloads

---

# Accessibility

Support

WCAG 2.2 AA

Keyboard Navigation

Screen Readers

RTL

LTR

Responsive Layout

---

# Performance Targets

Dashboard

<2 seconds

Team Search

<300 ms

Approvals

Near real-time after backend response

---

# Testing

Create

Component Tests

Permission Tests

Hierarchy Tests

Accessibility Tests

Responsive Tests

End-to-End Tests

---

# Documentation

Update

Manager Guide

Administrator Guide

API Usage Guide

Accessibility Guide

Deployment Guide

---

# Acceptance Criteria

✓ Managers can manage their teams

✓ Team visibility respects organizational hierarchy

✓ Workflow integration complete

✓ No duplicated business logic

✓ Responsive UI complete

✓ Accessibility requirements satisfied

✓ Production build successful

✓ Automated tests passing

---

# Definition of Done

Manager Self-Service is production ready.

Business logic remains exclusively in backend domains.

MSS consumes public APIs only.