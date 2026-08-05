# 03_PHASE_2_WORKFORCE_IDENTITY.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 2 – Workforce Identity

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements Workforce Identity.

It does NOT implement Authentication.

It does NOT implement Authorization.

Those are provided by Platform.

This module connects Platform Users to Workforce entities.

---

# Prerequisites

Claude MUST read

00_MASTER_INSTRUCTIONS.md

01_PHASE_0_WORK_BOOTSTRAP.md

02_PHASE_1_FOUNDATION.md

02A_PHASE_1_1_ARCHITECTURE_VERIFICATION.md

before implementation.

---

# Objectives

Connect Platform Users to Munaxa Work.

Implement Workforce User model.

Implement Tenant Membership.

Implement Invitations.

Implement User Lifecycle.

Implement Portal Access.

Implement Employment Linking.

Implement Delegation foundation.

---

# Non Goals

Do NOT implement

Authentication

Passwords

JWT

OAuth

SSO

Identity Providers

MFA

Session Management

Role Engine

Permission Engine

Platform APIs

Those belong to Platform.

---

# Business Vision

Platform knows

Who authenticated.

Munaxa Work knows

Who the business user is.

One authenticated user

↓

One Workforce User

↓

One or more Tenant Memberships

↓

One or more Employments

---

# Architecture

Platform

↓

Authenticated User

↓

Workforce User

↓

Tenant Membership

↓

Employment

This separation must never be violated.

---

# Responsibilities

The Workforce Identity Domain owns

User Profile

Tenant Membership

Invitation

Portal Access

Employment Link

Delegation

User Preferences

Business Profile

Nothing else.

---

# Mandatory Architecture Decisions

## AD-001

Authentication belongs to Platform.

---

## AD-002

Authorization framework belongs to Platform.

---

## AD-003

Workforce Identity never stores passwords.

---

## AD-004

Platform User ID is immutable.

---

## AD-005

One Platform User may belong to multiple tenants.

---

## AD-006

One Workforce User may be linked to multiple Employments.

Future concurrent employment must be supported.

---

## AD-007

Portal access is business configuration.

Not authentication.

---

## AD-008

Deleting an Employment never deletes the Workforce User.

---

## AD-009

Invitations create Workforce Users.

They never create Platform authentication.

Platform handles account creation.

---

## AD-010

Delegation belongs here.

Workflow consumes Delegation later.

---

# Scope

Workforce User

Tenant Membership

Invitation

Employment Link

Portal Assignment

Delegation

Business Preferences

Profile

Search

Import

Export

API

UI

Audit

History

Testing

Documentation

---

# Aggregate Roots

WorkforceUser

TenantMembership

Invitation

PortalAssignment

EmploymentLink

Delegation

UserPreference

BusinessProfile

These aggregates will be fully specified later.

---

# Domain Principles

Business identity

≠

Authentication

Authentication

≠

Authorization

Authorization

≠

Employment

Employment

≠

Person

Person

≠

Platform User

Every concept owns exactly one responsibility.

---

# High-Level Model

Platform User

↓

Workforce User

↓

Tenant Membership

↓

Employment Link

↓

Portal Assignments

↓

Delegations

This hierarchy must remain stable throughout the system.

---

# Future Consumers

People

Employment

Attendance

Leave

Payroll

Performance

Workflow

Notifications

Reporting

These domains consume Workforce Identity.

Workforce Identity consumes only Platform contracts.
