# 05A_PHASE_4_1_EMPLOYEE_DOCUMENTS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 4.1 – Employee Documents & Compliance Expiry

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Documents Domain.

Documents owns stored files, document types, issuance and expiry, and the monitoring that warns
before a document lapses.

Documents does NOT own the People registry. It does NOT own Employment. It does NOT own
Learning certifications — Learning owns training certificates and their expiry, and this domain
owns everything else.

An expired residency permit or work permit stops a person working legally. In this market that
is the single most operationally urgent piece of HR data, and no domain currently owns it.

---

# Prerequisites

`00_MASTER_INSTRUCTIONS.md`, `00A_PHASE_SPECIFICATION_TEMPLATE.md`,
`00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md`, and Phases 0 through 4.

---

# Objectives

Store and classify employee and organizational documents.

Track issuance, expiry and renewal.

Monitor expiry and escalate before the lapse, not after.

Support tenant-configurable document types and required-document rules.

Support verification and confidentiality.

Provide documents to Onboarding, Offboarding, Letters, Payroll and Integrations.

---

# Non Goals

Do NOT implement

Learning certifications — Phase 14 owns those.

Letter generation — Phase 5.1 owns that.

Government portal integration — Phase 22 owns connectivity; this domain owns the data.

Contract terms — Employment owns the contract; this domain owns its scanned file and expiry.

---

# Mandatory Architecture Decisions

## AD-001

Documents attach to a Person, an Employment, an Organization entity or a Dependent. The owner
type is explicit and never inferred.

## AD-002

Document types are tenant configurable. No document type is hardcoded — including residency
permits, work permits, passports and national identifiers, which vary by country and are
supplied by the country pack.

## AD-003

A document type declares whether it expires, whether it is mandatory, for whom it is mandatory,
whether it requires verification, and its confidentiality level.

## AD-004

Expiry monitoring is a projection with a scheduled evaluation. Notice periods are configurable
per document type, support multiple escalating thresholds, and route through Communications and
Workflow.

## AD-005

Files are stored through the Storage abstraction from Phase 1. No provider is referenced by any
business module.

## AD-006

Documents are versioned. Replacing a document creates a new version; the previous version is
retained and remains auditable. Nothing is overwritten.

## AD-007

Confidential documents are access-controlled independently of the employee record. Seeing an
employee does not imply seeing the employee's medical or disciplinary attachments.

## AD-008

Documents supports Audit, Soft Delete, Optimistic Concurrency, Effective Dating and Metadata.

---

# Domain model

**DocumentType** — code, name, owner type, expiry behaviour, mandatory rules, required fields,
confidentiality level, notice thresholds, country pack origin. Invariant: a type that expires
must define at least one notice threshold.

**Document** — owner reference, type, identifier number, issuing authority, issuing country,
issue date, expiry date, issue and expiry dates in both calendars, status, verification state,
confidentiality, file references, version. Invariants: expiry after issue; a mandatory type
cannot be satisfied by an expired document; a superseded document is never the current one.

**DocumentVersion** — immutable prior states with the actor and reason for replacement.

**DocumentRequirement** — the rule that a population must hold a document type, evaluated
against employment attributes and nationality.

**ExpiryNotice** — a raised warning, its threshold, its recipients and its acknowledgement.

**DocumentVerification** — who verified, when, against what, and the outcome.

---

# Lifecycle

Draft → Submitted → Verified → Active → Expiring → Expired → Renewed → Archived

A renewal creates a new document linked to its predecessor. History is never rewritten.

---

# Domain events

`DocumentAdded`, `DocumentVerified`, `DocumentReplaced`, `DocumentExpiringSoon`,
`DocumentExpired`, `DocumentRenewed`, `MandatoryDocumentMissing`.

Consumers: Communications, Workflow, Onboarding, Offboarding, Payroll (where a lapsed permit
blocks payment), GRC and Workforce Intelligence.

---

# Configuration

Document types and their fields.

Mandatory rules by nationality, employment type, legal entity and position.

Notice thresholds — for example 90, 60, 30 and 7 days, and after expiry.

Recipients per threshold: employee, manager, HR, government relations.

Confidentiality levels and the permissions that satisfy them.

Retention periods, coordinated with the GRC retention framework.

---

# Search

Document search, expiry search, missing-mandatory search, verification queue, by type, by
owner, by issuing authority, by expiry window, advanced search.

---

# Acceptance criteria

✓ Document types are fully tenant configurable

✓ Every document carries issue and expiry in both calendars

✓ Expiry notices fire at every configured threshold and escalate

✓ Missing mandatory documents are detectable for any population

✓ Replacing a document preserves the previous version

✓ Confidential documents are invisible without the specific permission

✓ Tenant isolation proven for every entity

✓ Quality gates pass

---

# Definition of Done

No employee can silently reach an expired permit. Every document is versioned, auditable and
access-controlled, and every other domain consumes documents through public contracts only.
