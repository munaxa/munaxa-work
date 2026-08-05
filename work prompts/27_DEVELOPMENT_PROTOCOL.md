# 27_DEVELOPMENT_PROTOCOL.md

# Munaxa Work
## Enterprise Development Protocol

Version: 1.0

Status: Mandatory

---

# IMPORTANT

This document defines the mandatory implementation workflow.

Claude must follow this workflow for every phase.

No phase may skip any step.

---

# Development Cycle

Every phase follows exactly the same lifecycle.

---

## Step 1

Read

00_MASTER_INSTRUCTIONS.md

Review all previous completed phases.

Review all ADRs.

Review current repository.

Do not implement anything yet.

---

## Step 2

Analyze

Produce

Repository Analysis

Architecture Analysis

Dependency Analysis

Risk Analysis

Implementation Strategy

Quality Strategy

No code changes.

Wait for approval.

---

## Step 3

Implementation

Implement only the approved phase.

Never implement future phases.

Never refactor unrelated modules.

---

## Step 4

Repository Verification

Verify

Architecture

Dependencies

Module Boundaries

Tenant Isolation

Permissions

CQRS

Events

Projections

---

## Step 5

Testing

Execute

Unit Tests

Integration Tests

Application Tests

API Tests

Repository Tests

Permission Tests

Regression Tests

---

## Step 6

Quality

Execute

ESLint

TypeScript

Production Build

Dependency Validation

Migration Validation

Unused Dependency Check

Dead Code Check

Circular Dependency Check

---

## Step 7

Performance

Measure

API Performance

Database Queries

Bundle Size

Build Time

Large Data Operations

Background Jobs

---

## Step 8

Security

Validate

Authorization

Tenant Isolation

Input Validation

Secrets

Headers

OWASP

Audit Logging

---

## Step 9

Documentation

Update

Architecture

README

Developer Guide

API

ER Diagram

ADRs

Release Notes

---

## Step 10

Completion Report

Provide

Executive Summary

Architecture Summary

Files Changed

Database Changes

API Changes

Testing Results

Performance Results

Security Results

Documentation Results

Known Issues

Technical Debt

Recommendations

---

## Step 11

STOP

Wait for approval.

Never begin the next phase automatically.

---

# Forbidden

Never

Skip phases

Implement multiple phases

Modify completed architecture

Duplicate business logic

Duplicate Platform functionality

Hardcode business rules

Ignore failed tests

Ignore failed builds

Leave TODOs

Leave FIXME comments

Bypass Application Services

Access repositories from another module

---

# Required

Always

Maintain backward compatibility

Maintain tenant isolation

Maintain audit history

Maintain effective dating

Maintain optimistic concurrency

Maintain module independence

Maintain documentation

Maintain automated tests

Maintain production build

---

# Definition of Success

A phase is complete only when:

- All acceptance criteria are satisfied.
- All tests pass.
- Production build succeeds.
- Documentation is updated.
- Architecture remains compliant.
- No critical issues remain.
- Approval has been received to continue.

---

# End of Development Protocol