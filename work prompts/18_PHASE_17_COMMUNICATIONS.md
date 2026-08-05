# 18_PHASE_17_COMMUNICATIONS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 17 – Enterprise Communications

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Enterprise Communications Domain.

Communications owns message delivery.

Communications owns templates.

Communications owns delivery channels.

Communications does NOT own business workflows.

Communications does NOT own business rules.

Business domains publish communication requests.

Communications delivers them.

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

16_PHASE_15_CAREER_SUCCESSION.md

17_PHASE_16_WORKFLOW.md

before implementation.

---

# Objectives

Implement enterprise communications.

Support multiple delivery channels.

Support reusable templates.

Support localization.

Support scheduling.

Support delivery tracking.

Support retries.

Support communication preferences.

Support reporting.

---

# Non Goals

Do NOT implement

Business approvals

Business rules

Workflow execution

Authentication

Portal UI

These domains consume Communications.

---

# Business Vision

Communications delivers messages.

Business domains decide when messages should be sent.

Communications decides how they are delivered.

---

# Scope

Communication Request

Message Template

Template Version

Channel

Recipient

Recipient Preference

Delivery Queue

Delivery Attempt

Delivery Status

Scheduled Message

Communication History

Communication Summary

REST API

Administration UI

Testing

Documentation

---

# Mandatory Architecture Decisions

## AD-001

Communications never owns business events.

Business domains publish communication requests.

---

## AD-002

Templates are versioned.

Historical messages retain the template version used at send time.

---

## AD-003

Channels are pluggable.

No delivery provider is hardcoded.

---

## AD-004

Support multiple recipients.

---

## AD-005

Support localized templates.

---

## AD-006

Delivery retries are configurable.

---

## AD-007

Communications supports

Audit

Soft Delete

Optimistic Concurrency

Metadata

---

# Aggregate Roots

CommunicationRequest

MessageTemplate

TemplateVersion

Channel

RecipientPreference

DeliveryQueue

DeliveryAttempt

ScheduledMessage

CommunicationHistory

CommunicationProjection

---

# Ubiquitous Language

Communication Request

Instruction to deliver a message.

Template

Reusable message definition.

Channel

Delivery mechanism.

Recipient

Message destination.

Delivery Attempt

Single send attempt.

Retry

Repeated delivery attempt.

Preference

Recipient delivery settings.

---

# Domain Principles

Business domains decide "when."

Communications decides "how."

Templates are reusable.

Delivery providers are replaceable.

One responsibility per domain.

---

# Supported Channels

Email

SMS

Push Notification

In-App Notification

Webhook

Future

Microsoft Teams

Slack

WhatsApp

Tenant configurable.

---

# Communication Lifecycle

Created

↓

Queued

↓

Processing

↓

Sent

↓

Delivered

↓

Read (where supported)

↓

Archived

Failures support retries and auditing.

---

# Templates

Support

Subject

Body

Localization

Variables

Attachments (future)

Versioning

Preview

---

# Scheduling

Support

Immediate

Scheduled

Recurring

Delayed

Time Zone Aware

---

# Delivery Tracking

Support

Queued

Sent

Delivered

Failed

Expired

Bounced (where applicable)

Read (where supported)

---

# Validation Rules

Validate

Template

Channel

Recipient

Localization

Scheduling

Retry Policy

Duplicate Requests (where applicable)

---

# Search

Support

Message Search

Template Search

Delivery Search

Recipient Search

Advanced Search

---

# High-Level Model

Business Domain

↓

Communication Request

↓

Template Resolution

↓

Channel Selection

↓

Delivery Queue

↓

Delivery Result

Communications remains independent of business logic.

---

# Future Consumers

Recruitment

Onboarding

Attendance

Leave

Compensation

Payroll

Benefits

Performance

Learning

Career

Workflow

Employee Portal

Manager Portal

Reporting

Analytics

Communications exposes public contracts only.