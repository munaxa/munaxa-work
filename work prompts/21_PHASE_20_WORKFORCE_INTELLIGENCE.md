# 21_PHASE_20_WORKFORCE_INTELLIGENCE.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 20 – Workforce Intelligence

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Workforce Intelligence Domain.

Workforce Intelligence owns reporting, dashboards, KPIs and analytics.

It owns no operational business data.

It consumes read projections from all business domains.

It never reads transactional tables directly.

---

# Prerequisites

Claude MUST complete every previous phase.

---

# Objectives

Implement enterprise reporting.

Implement dashboards.

Implement KPI framework.

Implement analytics.

Implement scheduled reports.

Implement report exports.

Implement executive dashboards.

Implement operational dashboards.

---

# Non Goals

Do NOT implement

Business calculations

Payroll calculations

Attendance calculations

Leave calculations

Performance calculations

AI

Machine Learning

Forecasting

Those belong to future phases.

---

# Business Vision

Every operational domain owns its data.

Workforce Intelligence owns how that information is presented.

No report should require knowledge of transactional implementation.

---

# Scope

Dashboard

Dashboard Widget

Report

Report Category

Saved Report

Scheduled Report

KPI

Metric

Filter

Visualization

Export

Snapshot

Report Template

Audit

History

REST API

Administration UI

Testing

Documentation

---

# Mandatory Architecture Decisions

## AD-001

Reporting consumes projections only.

Never query transactional tables directly.

---

## AD-002

Dashboards are configurable.

---

## AD-003

Reports are tenant configurable.

---

## AD-004

Widgets are reusable.

---

## AD-005

Scheduled reports execute in background jobs.

---

## AD-006

Exports are asynchronous.

---

## AD-007

Workforce Intelligence supports

Audit

Metadata

Versioned report definitions

Saved filters

---

# Aggregate Roots

Dashboard

DashboardWidget

Report

ReportTemplate

ScheduledReport

KPI

Metric

Visualization

ExportJob

SavedReport

WorkforceProjection

---

# Ubiquitous Language

Dashboard

Collection of widgets.

Widget

Reusable visualization.

Report

Structured information.

Metric

Calculated business measurement.

KPI

Strategic metric.

Snapshot

Point-in-time report.

Visualization

Presentation of data.

Export

Generated report output.

---

# Domain Principles

Operational domains own data.

Workforce Intelligence owns presentation.

Reports are projections.

Dashboards are configurable.

One responsibility per domain.

---

# Dashboard Types

Support

Executive Dashboard

HR Dashboard

Payroll Dashboard

Recruitment Dashboard

Attendance Dashboard

Learning Dashboard

Performance Dashboard

Manager Dashboard

Employee Dashboard

Tenant configurable.

---

# KPI Framework

Support configurable KPIs.

Examples

Headcount

Turnover

Absenteeism

Overtime

Payroll Cost

Leave Utilization

Recruitment Time-to-Hire

Training Completion

Performance Distribution

Nothing is hardcoded.

---

# Visualizations

Support

Table

Card

Line Chart

Bar Chart

Area Chart

Pie Chart

Heat Map

Gauge

Trend

Matrix

Future visualization types can be added.

---

# Scheduled Reports

Support

Daily

Weekly

Monthly

Quarterly

Yearly

Custom schedules

Time zone aware.

---

# Exports

Support

PDF

Excel

CSV

JSON

Background generation.

Large exports are queued.

---

# Search

Support

Report Search

Dashboard Search

KPI Search

Saved Report Search

Advanced Search

---

# High-Level Model

Domain Projections

↓

Metrics

↓

KPIs

↓

Dashboards

↓

Reports

↓

Exports

No direct dependency on operational tables.

---

# Future Consumers

Executive Portal

HR Portal

Manager Portal

Employee Portal

AI Workforce Intelligence

External BI Platforms

Reporting APIs

Workforce Intelligence exposes public contracts only.