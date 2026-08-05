# 00_ENGINEERING_STANDARDS.md

# Munaxa Work
## Enterprise Engineering Standards

Version: 1.0

Status: Mandatory

---

# IMPORTANT

This document defines the engineering standards for the Munaxa Work repository.

These standards apply to every module, every package, every application and every phase.

No implementation may violate these standards.

If implementation conflicts with this document,

STOP.

Request approval before continuing.

---

# General Principles

Code must be

Simple

Readable

Maintainable

Testable

Deterministic

Secure

Observable

Reusable

No clever code.

No hidden behavior.

Explicit over implicit.

---

# Language

TypeScript Strict Mode

Mandatory.

Forbidden

any

ts-ignore

eslint-disable

Non-null assertions unless justified.

---

# Naming

Classes

PascalCase

Interfaces

PascalCase

Types

PascalCase

Enums

PascalCase

Functions

camelCase

Variables

camelCase

Constants

UPPER_SNAKE_CASE

Files

kebab-case

Folders

kebab-case

Database

snake_case

---

# File Standards

Maximum

Class

400 lines

Function

60 lines

Controller

150 lines

Service

300 lines

Repository

250 lines

Split files before limits are exceeded.

---

# Complexity

Maximum cyclomatic complexity

10

Maximum nesting

3

Maximum parameters

5

Prefer Value Objects.

Prefer composition.

---

# Architecture Rules

Domain contains

Business Rules only.

Application contains

Use Cases.

Infrastructure contains

Persistence and external integrations.

API contains

Transport.

Presentation contains

UI.

Never violate dependency direction.

---

# Repository Rules

Repositories

Never contain business rules.

Never expose ORM entities.

Never call external services.

Return domain models only.

---

# API Standards

Every endpoint must support

OpenAPI

Problem Details (RFC 9457)

Validation

Authorization

Correlation ID

Request ID

Audit

Pagination (where applicable)

Filtering (where applicable)

Sorting (where applicable)

Versioning

Idempotency (where applicable)

---

# Database Standards

Engine

PostgreSQL

ORM

Prisma

Naming

snake_case

IDs

UUIDv7

Timestamps

UTC

Soft Delete

deleted_at

Audit

created_at

created_by

updated_at

updated_by

deleted_at

deleted_by

Version

version

Indexes

Explicitly defined

Foreign Keys

Explicitly named

---

# Validation

Validate

Input

Business Rules

Authorization

Tenant

Configuration

No silent failures.

---

# Error Handling

Use RFC 9457 Problem Details.

Never expose

Stack traces

Internal errors

Secrets

SQL

Environment information

---

# Logging

Structured JSON logging.

Every log includes

Timestamp

Request ID

Correlation ID

Tenant ID

User ID (when available)

Log Level

No console.log outside local development.

---

# Security

Mandatory

OWASP Top 10

Input Validation

Output Encoding

Rate Limiting

Secure Headers

Secret Management

Encryption in Transit

Encryption at Rest where required

PII Protection

Audit Logging

Least Privilege

---

# UI Standards

Use Platform UI only.

Support

Loading States

Skeletons

Error States

Empty States

Confirmation Dialogs

Responsive Design

RTL

LTR

Keyboard Navigation

WCAG 2.2 AA

No duplicate components.

---

# Performance Budgets

API Response

<300 ms

Search

<500 ms

Dashboard Load

<2 seconds

Initial Page Load

<2 seconds

Large Import

Background Job

Large Export

Background Job

---

# Testing Standards

Every module requires

Unit Tests

Integration Tests

Application Tests

API Tests

Permission Tests

Tenant Isolation Tests

Regression Tests

Critical business logic must be covered by automated tests.

---

# Quality Gates

The following gates are mandatory before a phase is complete.

Architecture Review

PASS

TypeScript

PASS

ESLint

PASS

Unit Tests

PASS

Integration Tests

PASS

Production Build

PASS

Migration Validation

PASS

Security Scan

PASS

Documentation

PASS

---

# Documentation Standards

Every phase updates

README

Architecture

OpenAPI

ER Diagram

ADRs

Release Notes

Developer Guide

Administrator Guide

No undocumented behavior.

---

# Git Standards

Small commits.

Meaningful commit messages.

No generated files unless required.

No commented-out code.

No TODO left in production code.

No FIXME left in production code.

---

# Forbidden

Never

Duplicate business logic

Duplicate Platform functionality

Hardcode tenant data

Hardcode business rules

Bypass Application Services

Access repositories across module boundaries

Introduce circular dependencies

Disable lint rules

Suppress type errors

Ignore failing tests

---

# Definition of Engineering Success

Every implementation must satisfy

Architecture compliant

CI green

Production build successful

Quality gates passed

Security validated

Performance budgets achieved

Documentation complete

No critical technical debt

---

# End of Engineering Standards