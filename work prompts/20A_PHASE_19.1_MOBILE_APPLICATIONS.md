# 20A_PHASE_19_1_MOBILE_APPLICATIONS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 19.1 – Mobile Applications

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the employee and manager mobile applications.

Mobile is an application layer. It owns no business logic and duplicates no calculation. It
consumes the same versioned APIs as the web portals.

Munaxa Work is described as mobile-first. Phase 0 bootstraps a mobile application and no phase
until this one gives it any functionality. For the majority of an enterprise workforce — site
staff, drivers, shift workers, field teams — the mobile app is the *only* interface they will
ever use. It is not a companion to the portal; for most users it is the product.

---

# Prerequisites

Phases 0 through 19.

---

# Objectives

One mobile application serving both employee and manager capabilities, gated by permission.

Attendance from the device: punch, location, and offline capture.

Requests and approvals on the move.

Payslips, balances, documents and letters in the pocket.

Push notifications.

Biometric device unlock.

Arabic and English, RTL and LTR, Hijri and Gregorian.

Offline for the operations that genuinely need it.

---

# Non Goals

Do NOT implement

Business logic, validation, calculation or approval rules.

A separate API. Mobile consumes `/api/v1` exactly as the portals do.

A second design system. Mobile consumes the Platform mobile components.

Advertising, campaign popups or third-party marketing to employees. An HR application holds an
employee's salary and medical claims; monetizing that audience is prohibited.

---

# Mandatory Architecture Decisions

## AD-001

Mobile consumes Application Services through versioned REST APIs only. No repository access, no
database access, no direct domain access.

## AD-002

Authentication comes from Platform. Device biometric unlock protects a Platform-issued session;
it never becomes an independent authentication mechanism.

## AD-003

Permissions are enforced by the backend. The application hides what a user cannot do, and the
backend refuses it regardless.

## AD-004

Offline support is explicit and limited to declared operations. Every offline operation is
idempotent, carries a client-generated identifier, and resolves conflicts on a stated rule.
Silent data loss is prohibited.

## AD-005

Attendance punches captured offline record the true event time and the sync time separately.
Attendance never trusts device clock alone; the server records receipt and flags divergence.

## AD-006

Location is captured only where the tenant enables it, only for the operation that requires it,
and the employee is told. Continuous background tracking is prohibited.

## AD-007

No business data is persisted unencrypted on the device. Cached data is scoped to the session
and cleared on logout, permission change or remote wipe.

## AD-008

Push notifications carry no confidential content — a notification says a payslip is available,
never what it contains.

## AD-009

The application supports the same accessibility standard as the portals: WCAG 2.2 AA, screen
readers, dynamic type, contrast, and full RTL mirroring.

---

# Functional scope — employee

Dashboard with configurable widgets: service period, leave balances, loan balance, next shift,
pending tasks, announcements.

Attendance: punch in and out, location where enabled, today's record, history, schedule, missing
punch correction request, overtime request.

Leave: balances including projected end-of-year balance, request with dual-calendar dates,
attachments from camera, replacement employee, cancellation, approval progress with named
approvers.

Requests: hourly leave, overtime, financial and medical claims, personal data change, general
requests — every one submitted as a transaction that routes through Workflow.

Payroll: payslips, year-to-date summary, secure download.

Profile: personal data, contacts, addresses, bank information, education, certificates, assets in
custody with acknowledgement, documents with expiry.

Letters: request and download permitted letters.

Learning, performance and career views.

Notifications and announcements.

---

# Functional scope — manager

Approval inbox with bulk action, delegation, and the full workflow trail.

Team attendance today, absences, late arrivals, missing punches, shift coverage.

Team leave calendar and coverage planning.

Team directory and organization tree.

Team performance, learning compliance and probation status.

Permission-gated compensation visibility.

---

# Offline operations

Declared offline-capable: attendance punch, draft requests, cached payslips and documents
already downloaded, cached team lists.

Everything else requires connectivity and says so.

Conflict rules are stated per operation and surfaced to the user, never resolved silently.

---

# Security

Platform authentication. Session binding to device. Biometric unlock. Certificate pinning.
Jailbreak and root detection with tenant-configurable policy. Remote session revocation. No
screenshots on payslip and salary screens where the tenant requires it. Encrypted local storage.
Clear-on-logout.

---

# Performance budget

Cold start under 3 seconds. Dashboard under 2 seconds on a 3G connection. Punch action
acknowledged locally in under 500 milliseconds, synchronized in the background. Offline queue
drains automatically on reconnection.

---

# Test matrix

Widget and component tests. Permission tests. Offline and sync tests, including conflicting
edits and clock divergence. Localization tests in both languages and directions, both calendars.
Accessibility tests. Device matrix tests across supported operating system versions. End-to-end
tests against a running API. Security tests covering storage, session and revocation.

---

# Acceptance criteria

✓ One application, both roles, permission-gated

✓ Attendance punch works offline and reconciles correctly, with divergence flagged

✓ Every request type available on mobile routes through Workflow

✓ Full Arabic and RTL, dual calendar throughout

✓ No business logic duplicated from any backend domain

✓ No advertising or third-party marketing surface

✓ Accessibility standard met

✓ Production builds pass for both platforms

✓ Quality gates pass

---

# Definition of Done

An employee who never opens a browser can do their entire HR life from the application, and a
manager can run their team from it — with every rule still enforced by the backend.
