# 26_ARCHITECTURE_DECISION_RECORDS.md

# Munaxa Work
## Enterprise Architecture Decision Records (ADR)

Version: 1.0

Status: Living Document

---

# IMPORTANT

This document records permanent architectural decisions.

It is the single source of truth for architecture decisions.

If implementation conflicts with an ADR,

STOP.

Do not continue.

Document the conflict.

Request approval before changing the architecture.

Architecture decisions are never changed silently.

---

# ADR-0001

Title

Platform Ownership

Decision

Platform owns

Authentication

Authorization

Design System

RBAC

Shared Components

Shared Infrastructure

Munaxa Work consumes Platform.

Never duplicate Platform functionality.

Status

Accepted

---

# ADR-0002

Title

Deployment Agnostic Architecture

Decision

Business logic is deployment independent.

The application must execute without modification on

Cloud

On-Premises

Hybrid

Containers

Kubernetes

---

# ADR-0003

Title

Multi-Tenant First

Decision

Every business entity belongs to exactly one tenant unless explicitly documented.

Cross-tenant access is prohibited.

Tenant isolation is mandatory.

---

# ADR-0004

Title

Domain Ownership

Decision

Every business concept has one owner.

No duplicated ownership.

Examples

Person

↓

People

Employment

↓

Employment

Attendance

↓

Attendance

Leave Balance

↓

Leave

Payroll Result

↓

Payroll

---

# ADR-0005

Title

Application Services

Decision

Every business operation executes through Application Services.

Repositories never contain business rules.

---

# ADR-0006

Title

Repository Pattern

Decision

Repositories return domain models.

Repositories never expose ORM entities.

---

# ADR-0007

Title

Event Driven Architecture

Decision

Business domains publish immutable domain events.

Consumers subscribe through public contracts.

---

# ADR-0008

Title

Projection Architecture

Decision

Reporting consumes projections.

Never transactional tables.

---

# ADR-0009

Title

Workflow Ownership

Decision

Workflow owns approvals.

Business domains own business rules.

---

# ADR-0010

Title

Communications Ownership

Decision

Communications owns message delivery.

Business domains determine when communication is required.

---

# ADR-0011

Title

Integration Hub

Decision

External systems communicate only with the Integration Hub.

Business domains never integrate directly.

---

# ADR-0012

Title

AI Governance

Decision

AI provides recommendations.

AI never performs critical business actions.

---

# ADR-0013

Title

Presentation Layer

Decision

Admin

Employee

Manager

Mobile

are presentation applications.

No application contains business logic.

---

# ADR-0014

Title

Single Source of Truth

Decision

Each domain owns one business responsibility.

Duplicate data ownership is prohibited.

---

# ADR-0015

Title

Effective Dating

Decision

Historical information is preserved.

Business history is immutable.

---

# ADR-0016

Title

Audit

Decision

All business domains implement

Audit

Versioning

Optimistic Concurrency

Metadata

---

# ADR-0017

Title

Module Independence

Decision

Modules communicate only through

Application Services

Public Contracts

Domain Events

Never through direct repository access.

---

# ADR-0018

Title

Configuration

Decision

Business behavior is configurable.

Nothing business-specific is hardcoded.

---

# ADR-0019

Title

Security

Decision

Authentication belongs to Platform.

Business authorization belongs to Munaxa Work.

---

# ADR-0020

Title

Performance

Decision

Dashboards consume projections.

Long-running operations execute asynchronously.

Large exports execute in background jobs.

---

# ADR-0021 and ADR-0022

Reserved.

Recorded in `docs/adr/` — engineering standards enforcement, and master instructions
enforcement. They are repository decisions rather than product architecture, and they live with
the tooling that enforces them.

---

# ADR-0023

Title

Module-First Repository Structure

Decision

Business code is organized module-first: `packages/modules/<module>/{domain, application,
infrastructure, contracts, api}`. Layers exist inside a module, never above it.

Reason

Module independence, per-module registration and eventual extraction to services all assume the
module is the unit. An earlier draft of Phase 0 grouped packages by layer, which contradicted
Phase 1 and would have made every module boundary a convention rather than a structure.

Status

Accepted

---

# ADR-0024

Title

Ports Precede Their Engines

Decision

The Shared Kernel defines ApprovalPort, NotificationPort and DocumentPort in Phase 1, with
in-process default adapters. Business domains depend on the port from their first commit.
Workflow (Phase 16) and Communications (Phase 17) supply the real adapters without changing any
business domain.

Reason

Five operational domains need approvals and notifications years before those engines exist in
the sequence. The alternative is retrofitting approvals into completed domains, which is
prohibited.

Status

Accepted

---

# ADR-0025

Title

Country Packs Own the Law

Decision

Statutory behaviour lives in versioned country packs, resolved from the Legal Entity of an
Employment. No business module contains country logic; no country pack contains business logic.
Packs are effective-dated, never edited in place, and every statutory figure is traceable to its
rule, version and inputs.

Reason

The product is sold into markets that select on statutory correctness. The abstraction alone is
not a product, and country logic inside business modules makes every new market a code change.

Status

Accepted

---

# ADR-0026

Title

Self Service Is Transactional

Decision

Self-service applications never edit master data. Every employee and manager action is a
transaction carrying its own validation, approval and audit, mutating business data only through
the owning domain's Application Service after approval.

Reason

Direct edits from a portal bypass approval, produce no audit narrative, and make it impossible
to answer who changed a bank account and who authorized it.

Status

Accepted

---

# ADR-0027

Title

Bilingual and Bi-Calendar Foundation

Decision

Arabic and English are both first-class, and Gregorian and Hijri are both accepted for input and
available for display. Calendar conversion is a Shared Kernel capability implemented once in
Phase 1. Storage is always UTC; calendar is an input and presentation concern.

Reason

Retrofitting a second calendar into date handling after Leave, Attendance, Payroll and Documents
are built means touching every one of them. It is a foundation concern or it is a rewrite.

Status

Accepted

---

# ADR-0028

Title

Mobile Is a First-Class Client

Decision

The mobile application is a required phase (19.1) consuming the same versioned APIs as the
portals, duplicating no business logic, and carrying no advertising or third-party marketing.

Reason

For most of an enterprise workforce the mobile application is the only interface they will use.
An application holding an employee's salary and medical claims does not monetize its audience.

Status

Accepted

---

# Future ADRs

Every architectural decision made after implementation begins must be recorded here.

Existing ADRs are never modified silently.

Superseded ADRs remain in history.

Every ADR contains

Decision

Reason

Consequences

Alternatives Considered

Date

Author

Approval Status

---

# End of ADR Document