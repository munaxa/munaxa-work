# 00_MASTER_INSTRUCTIONS.md

# Munaxa Work
## Enterprise Implementation Master Instructions

Version: 1.0

Status: Mandatory

---

# IMPORTANT

This document defines the permanent architectural rules for Munaxa Work.

Every implementation phase must follow these instructions.

These rules override implementation preferences.

If any future phase conflicts with this document,

STOP.

Explain the conflict.

Do not continue implementation until the conflict is resolved.

---

# Product

Product Name

Munaxa Work

Category

Enterprise Human Capital Management (HCM)

Deployment

Cloud SaaS

Single codebase

Multi-tenant

API-first

Mobile-first

Web-first

---

# Vision

Munaxa Work is a modern enterprise Human Capital Management platform.

It is not a traditional HR system.

It must compete with

• Menaitech

• Workday

• SAP SuccessFactors

• Oracle HCM

• BambooHR

while providing a cleaner architecture and a better user experience.

---

# Platform

Munaxa Work consumes the shared Platform repository.

Platform is a separate repository.

Platform owns

Authentication

Authorization

Design System

Design Tokens

RBAC Framework

Shared Components

Shared Utilities

Shared Infrastructure

Munaxa Work must never duplicate Platform functionality.

---

# Technology Stack

Frontend

Next.js

TypeScript

React

Backend

Node.js

TypeScript

Prisma

PostgreSQL

Styling

Consume Platform UI package.

Do not create another design system.

---

# Architecture

The system follows

Domain Driven Design

Clean Architecture

CQRS where appropriate

Event Driven Architecture

Modular Monolith

Deployment Agnostic Design

Future Microservice Ready

---

# Deployment

The application must run without business code changes on

Cloud

On-premises

Hybrid

Containerized

Kubernetes

Single Server

Infrastructure must never affect business logic.

---

# Multi-Tenancy

The system is tenant-first.

Every business entity belongs to exactly one tenant unless explicitly documented otherwise.

Tenant isolation is mandatory.

No cross-tenant data leakage.

---

# Single Source of Truth

Every concept has exactly one owner.

Examples

Person

owns identity.

Employment

owns employment.

Attendance

owns attendance.

Leave

owns leave.

Payroll

owns payroll.

Never duplicate business ownership.

---

# Shared Architectural Patterns

The following patterns are mandatory.

Versioned Child Entity

Timeline Projection

Projection Read Models

Application Services

Domain Services

Optimistic Concurrency

Soft Delete

Audit

Effective Dating

Domain Events

No future phase may introduce competing patterns.

---

# Coding Standards

Use

SOLID

DDD

Composition over inheritance

Dependency inversion

Explicit interfaces

Pure domain models

Avoid

God Objects

Fat Controllers

Business logic in controllers

Business logic in repositories

Global mutable state

Hardcoded values

---

# Configuration

Configuration must be externalized.

No environment-specific business logic.

No hardcoded tenant configuration.

No hardcoded countries.

No hardcoded currencies.

No hardcoded labor laws.

Everything configurable.

---

# Internationalization

Architecture must support

Multiple Languages

Multiple Time Zones

Multiple Calendars

Multiple Currencies

RTL

LTR

No assumptions about country.

---

# Security

Authentication comes from Platform.

Authorization comes from Platform.

Business authorization belongs inside the application.

Every endpoint validates

Authentication

Authorization

Tenant

Business Rules

Audit

---

# API

REST first.

Versioned APIs.

/api/v1

OpenAPI required.

Problem Details required.

Idempotency where appropriate.

---

# Database

PostgreSQL

Prisma

UTC timestamps

UTF-8

Soft Delete

Audit

Versioning

Effective Dating

Optimistic Concurrency

---

# Events

Events are immutable.

Publish after successful transaction commit.

Events are versioned.

Events include

EventId

TenantId

OccurredAt

Actor

CorrelationId

Payload

---

# UI

Consume Platform UI only.

Never duplicate components.

Never modify Platform.

Work owns business screens only.

---

# Performance Targets

Interactive APIs

<300ms

Search

<300ms

Page Load

<2s

Large imports

Background jobs

No blocking long-running requests.

---

# Testing

Every phase requires

Unit Tests

Integration Tests

Application Service Tests

Repository Tests

Permission Tests

Tenant Isolation Tests

API Tests

Regression Tests

Production Build

CI must pass before continuing.

---

# Documentation

Every phase updates

Architecture

ER Diagram

API Documentation

OpenAPI

ADR

Developer Guide

Administrator Guide

Release Notes

---

# Definition of Done

No phase is complete until

Architecture respected

Tests passing

CI passing

Production build passing

Documentation updated

ADRs written

No critical issues remain

Implementation is production ready

---

# Implementation Order

Claude must implement phases strictly in order.

No future phase may begin before the previous phase satisfies its acceptance criteria.

Skipping phases is prohibited.

Changing completed architecture requires an ADR and explicit approval.

---

# End of Master Instructions