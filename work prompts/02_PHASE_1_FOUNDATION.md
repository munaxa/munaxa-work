# 02_PHASE_1_FOUNDATION.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 1 – Enterprise Foundation

Version: 1.0

Status: Approved for Implementation

---

# IMPORTANT

This phase establishes the technical architecture of Munaxa Work.

No HR functionality is implemented.

No business workflows are implemented.

The purpose is to build the enterprise foundation that every future module will use.

---

# Prerequisites

Claude MUST read

00_MASTER_INSTRUCTIONS.md

01_PHASE_0_WORK_BOOTSTRAP.md

before implementation.

---

# Objectives

Establish the architectural framework.

Implement shared kernel.

Implement event infrastructure.

Implement module registration.

Implement dependency boundaries.

Implement repository abstractions.

Implement CQRS foundation.

Implement audit infrastructure.

Implement optimistic concurrency.

Implement soft delete infrastructure.

Implement effective dating infrastructure.

Prepare for multi-tenancy.

---

# Non Goals

Do NOT implement

Identity

Organization

People

Employment

Attendance

Payroll

Recruitment

Leave

Benefits

Performance

Learning

Workflow

Notifications

Reports

AI

No business rules.

---

# Foundation Principles

The Foundation layer must

Contain no business logic.

Contain no tenant-specific rules.

Contain no HR concepts.

Remain reusable by every future module.

---

# Shared Kernel

Create a Shared Kernel.

The Shared Kernel owns

Entity

AggregateRoot

ValueObject

DomainEvent

DomainException

Repository

UnitOfWork

Specification

Result

Error

Money

DateRange

AuditInformation

VersionInformation

PagedResult

CursorResult

BusinessDate

Calendar conversion — Gregorian and Hijri (Umm al-Qura), implemented once, here

ServicePeriod — whole-day service duration on a stated calendar

Quantity — fractional day and hour quantities with explicit rounding

Percentage

LocalizedText

ApprovalPort

NotificationPort

DocumentPort

RuleDefinition and RuleEvaluator

EffectiveDatedCollection

TimelineProjection

Domain modules must consume these abstractions.

---

# Ports Required Before Their Engines Exist

Workflow is Phase 16 and Communications is Phase 17, but Attendance, Leave, Compensation,
Payroll, Recruitment and every other operational domain need approvals and notifications long
before those phases run.

Phase 1 therefore defines

ApprovalPort

NotificationPort

DocumentPort

with in-process default adapters. Business domains depend on the port from their first commit.
Phases 16 and 17 supply the real adapters and nothing in a business domain changes.

Retrofitting approvals into five completed domains is prohibited. See ADR-0024.

---

# Rule Engine

Provide one shared rule and formula engine.

It is consumed by

Leave accrual and eligibility

Attendance exception evaluation

Compensation eligibility

Payroll formulas

Benefit eligibility

Loan eligibility

Statutory country packs

Compliance rules

Rules are versioned definitions with effective dates. Evaluation is deterministic, sandboxed,
side-effect free, and explains its result — which rule, which version, which inputs, which
intermediate values.

One engine. No module implements its own.

---

# Localization Infrastructure

Provide

Translation catalogue loading and resolution

Locale resolution: tenant default, user override

Direction resolution

Calendar preference resolution

Number, date and currency formatting per locale

Translation completeness verification, enforced in CI

No user-visible string is authored in a business module without a catalogue key.

---

# Module Architecture

Every future module follows exactly the same structure.

modules/

    <module>/

        domain/

        application/

        infrastructure/

        contracts/

        api/

No module accesses another module's internal implementation.

Communication occurs through

Public Contracts

Application Services

Domain Events

---

# Dependency Rules

Allowed

Application → Domain

Infrastructure → Domain

Infrastructure → Application

API → Application

Forbidden

Domain → Infrastructure

Domain → API

Domain → UI

Application → UI

Cross-module infrastructure dependencies

---

# CQRS Foundation

Prepare infrastructure for

Commands

Queries

Handlers

Validators

Pipelines

No commands implemented yet.

---

# Domain Events

Create a reusable event system.

Every event contains

EventId

EventName

Version

TenantId

OccurredAt

CorrelationId

CausationId

Actor

Payload

Events are immutable.

Events are published only after successful transaction commit.

---

# Event Dispatcher

Create abstractions only.

Support

In-process

Message Bus

Future Event Streaming

Implementation remains provider independent.

---

# Repository Pattern

Repositories expose domain operations.

Repositories never contain business rules.

Repositories never expose ORM objects.

Repositories return domain models.

---

# Unit of Work

Prepare transaction abstraction.

Support

Commit

Rollback

Nested transactions (future)

---

# Audit Infrastructure

Create reusable audit interfaces.

Every auditable entity exposes

CreatedAt

CreatedBy

UpdatedAt

UpdatedBy

DeletedAt

DeletedBy

AuditVersion

Audit implementation is automatic.

---

# Soft Delete

Provide reusable support.

Deleted entities remain recoverable.

Queries exclude deleted records by default.

Administrative queries may include deleted records.

---

# Effective Dating

Provide reusable infrastructure.

Every versioned entity supports

EffectiveFrom

EffectiveTo

VersionNumber

IsCurrent

Historical queries.

Future scheduling.

---

# Optimistic Concurrency

Every mutable aggregate supports

VersionNumber

Conflicting updates return concurrency errors.

Silent overwrites are prohibited.

---

# Multi-Tenant Infrastructure

Provide

Tenant Context

Tenant Resolver

Tenant Validation

Tenant Middleware

Tenant Scoping

Every future repository consumes this infrastructure.

---

# Module Registration

Create automatic module registration.

Each module registers

Permissions

Navigation

Commands

Queries

Event Handlers

API Routes

Health Checks

No manual registration.

---

# Feature Flags

Provide

Feature Flag Provider

Feature Evaluation

Tenant Feature Overrides

No feature flags defined yet.

---

# Background Processing

Create abstractions.

Support

Scheduled Jobs

Queue Jobs

Recurring Jobs

Future distributed execution.

No concrete jobs implemented.

---

# Search Infrastructure

Create search abstraction.

Support

Full Text

Faceted

Incremental

Provider independent.

---

# Storage Infrastructure

Create abstraction.

Support

Local

Cloud

Future providers

No concrete implementation required.

---

# Notification Infrastructure

Create abstraction.

Support

Email

SMS

Push

Webhooks

Future channels

No implementation.

---

# Validation

Create reusable validation framework.

Support

Input Validation

Business Validation

Cross-field Validation

Pipeline Validation

---

# Health Monitoring

Provide

Health Checks

Readiness Checks

Liveness Checks

Version Endpoint

Build Metadata

Dependency Status

---

# Testing Infrastructure

Create

Test Builders

Object Mothers

Fixtures

Fake Repositories

Test Event Dispatcher

Shared Assertions

---

# Documentation

Create

Foundation Architecture

Dependency Diagram

Module Architecture Guide

CQRS Guide

Event Guide

Coding Standards

ADR-0003 Foundation Architecture

ADR-0004 Module Boundaries

---

# Acceptance Criteria

✓ Shared Kernel implemented

✓ Module architecture implemented

✓ CQRS infrastructure implemented

✓ Event infrastructure implemented

✓ Repository abstractions implemented

✓ Unit of Work implemented

✓ Audit infrastructure implemented

✓ Effective dating infrastructure implemented

✓ Soft delete infrastructure implemented

✓ Optimistic concurrency implemented

✓ Tenant infrastructure implemented

✓ Module registration implemented

✓ Calendar conversion implemented and tested against published Umm al-Qura data

✓ Approval, Notification and Document ports defined with in-process adapters

✓ Rule engine implemented, deterministic and self-explaining

✓ Localization infrastructure implemented, completeness enforced in CI

✓ Projection rebuild-from-events implemented as a foundation capability

✓ Foundation documentation completed

✓ CI passing

✓ Production build passing

---

# Definition of Done

The technical architecture is complete.

No business functionality exists.

Every future module can be built without architectural changes.

---

# Completion Report

Provide

Architecture Summary

Shared Kernel Summary

Dependency Validation

Module Registration Summary

CQRS Summary

Event Summary

Testing Summary

Documentation Summary

ADR Summary

Readiness Assessment

---

# End of Phase 1

Stop after the foundation is complete.

Do not begin Phase 2.