# 06A_PHASE_5_1_EMPLOYEE_LETTERS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 5.1 – Employee Letters & Certificates

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Letters Domain.

Letters owns templates, generation, approval, issuance and the register of everything issued.

Letters owns no business data. Every value in a letter is read from the domain that owns it,
at the moment of issue, and frozen into the issued document.

Salary certificates, employment letters, embassy letters and experience certificates are among
the highest-volume HR requests in this market. A self-service letter that issues without HR
touching it is a visible, daily win for the customer.

---

# Prerequisites

Phases 0 through 5, plus Phase 4.1.

---

# Objectives

Tenant-configurable letter templates in both languages.

Employee-requested and HR-issued letters.

Approval routing before issue where the template requires it.

Immutable issued documents with a verifiable reference.

A register of every letter issued, to whom, by whom and when.

---

# Non Goals

Do NOT implement

Contract documents — Employment owns contracts.

Payslips — Payroll owns payslips.

Communications delivery — Communications delivers; this domain produces.

Document storage — the Storage abstraction stores; this domain owns the register.

---

# Mandatory Architecture Decisions

## AD-001

Templates are tenant configurable, versioned, and authored in Arabic and English. A letter is
issued in the language the requester selects.

## AD-002

Template variables bind to public contracts of owning domains — never to tables, never to
another module's repository.

## AD-003

An issued letter is immutable. Its content is frozen at issue, including the template version
and every substituted value. Correcting a letter issues a new one and marks the original
superseded.

## AD-004

Letter types declare their approval requirement. Approval routes through Workflow.

## AD-005

Letters declare which fields they may expose. A template may not expose salary unless the
letter type permits it and the requester holds the permission.

## AD-006

Every issued letter carries a unique reference and, where the tenant enables it, a verification
mechanism allowing a third party to confirm authenticity without seeing employee data.

## AD-007

Letters supports Audit, Soft Delete, Optimistic Concurrency and Metadata.

---

# Domain model

**LetterTemplate** — code, name, language variants, body with variables, letterhead, required
permissions, approval requirement, exposed field set, validity period. Versioned.

**LetterRequest** — requester, subject employment, template, language, purpose, addressee,
requested delivery, state.

**IssuedLetter** — frozen content, template version, substituted values, reference number,
issue date in both calendars, signatory, file reference, verification token, superseded-by.

**LetterRegister** — the searchable record of issuance.

---

# Lifecycle

Requested → Pending Approval → Approved → Generated → Issued → Delivered → Superseded / Expired

Rejected and Cancelled are terminal. Every transition is audited.

---

# Standard letter types shipped as configuration

Employment certificate. Salary certificate. Salary transfer letter to a bank. Experience
certificate. Embassy and visa letter. No-objection certificate. Secondment letter. Warning
letter — issued from Employee Relations, rendered here. Promotion, transfer and confirmation
letters. Contract renewal notice. End of service certificate.

None is hardcoded. Each ships as a default template a tenant may edit or disable.

---

# Domain events

`LetterRequested`, `LetterApproved`, `LetterIssued`, `LetterSuperseded`, `LetterVerified`.

---

# Acceptance criteria

✓ Templates configurable and versioned in both languages

✓ Issued letters immutable, referenced and reproducible byte-for-byte

✓ Approval enforced where the type requires it

✓ Salary exposure gated by permission

✓ Letters render correctly RTL and LTR, with both calendars

✓ Employees can request permitted letters from self-service without HR intervention

✓ Quality gates pass

---

# Definition of Done

A tenant can define, approve and issue every letter it uses today, in both languages, with a
complete register and no manual document assembly.
