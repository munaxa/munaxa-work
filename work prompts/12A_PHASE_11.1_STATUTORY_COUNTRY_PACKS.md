# 12A_PHASE_11_1_STATUTORY_COUNTRY_PACKS.md

# Enterprise Architecture Specification
## Munaxa Work
### Phase 11.1 – Statutory Engine & Country Packs

Version: 1.0

Status: Approved

---

# IMPORTANT

This phase implements the Statutory Engine and the first country packs.

Every other phase is deliberately country-neutral. This is the phase where the law lives.

This is the phase that decides whether Munaxa Work can be sold. A buyer in this market does not
select an HCM on architecture — they select on whether end of service, social insurance and the
wage protection file are correct, on the first run, for their country. Competing products ship
"pre-loaded country compliance profiles"; this phase is our equivalent, and it must be at least
as complete for the countries we sell into.

Everything here is financial code. It is deterministic, versioned, traceable, tested against
golden cases and reviewed against the published law.

---

# Prerequisites

Phases 0 through 11, and `00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md`.

---

# Objectives

Implement the statutory rule engine that Payroll, Leave, Employment and Documents consume.

Implement end of service and gratuity.

Implement social insurance contributions.

Implement income tax where applicable.

Implement wage protection and payment file generation.

Implement statutory reporting.

Deliver country packs for Saudi Arabia, Jordan and the United Arab Emirates, then Kuwait,
Qatar, Egypt, Oman and Bahrain.

---

# Non Goals

Do NOT implement

Payroll orchestration — Phase 11 owns the run; this phase owns the rules it applies.

Government portal connectivity — Phase 22 owns transmission; this phase owns the content and
format.

Accounting — journals export to ERP.

Business logic of any operational domain.

---

# Mandatory Architecture Decisions

## AD-001

A country pack is versioned with effective dates. A rate, ceiling, entitlement or format change
is a new version. Nothing is ever edited in place.

## AD-002

Historical calculation always uses the version in force on the date being calculated. A payroll
re-run for a prior period must reproduce the original result exactly.

## AD-003

Every statutory output is traceable: which rule, which version, which inputs, which intermediate
values. A payroll figure that cannot explain itself is a defect.

## AD-004

The pack applies to an Employment through its Legal Entity's country, never through the tenant.
One tenant may run several countries simultaneously.

## AD-005

Nationality, residency status and employment type are inputs to statutory rules. They are never
business rules in an operational domain.

## AD-006

Rules are expressed in the shared rule engine from Phase 1, as configuration and versioned
definitions. Provider code exists only where a government interface requires a specific format
or protocol.

## AD-007

Every statutory calculation ships with golden-case tests, citing the published source. A pack
without golden cases is not releasable.

## AD-008

Statutory rounding is explicit and per rule. Rounding is never left to a default.

## AD-009

Supports Audit, Versioning, Effective Dating, Metadata and complete traceability.

---

# Domain model

**CountryPack** — country, version, effective range, publication reference, status.

**StatutoryRuleSet** — the rules a pack contains, by concern: end of service, social insurance,
tax, leave entitlement, working time, payment file, reporting.

**StatutoryRule** — identifier, concern, applicability predicate, computation definition,
rounding, effective range, source citation.

**ContributionScheme** — scheme, contributor eligibility, wage base definition, employee and
employer rates, floors, ceilings, treatment by nationality and employment type.

**EndOfServiceRule** — accrual basis, service bands, entitlement fractions, treatment by
termination reason, wage base, offsets and caps.

**PaymentFileFormat** — layout, encoding, required fields, validation, submission calendar.

**StatutoryReport** — definition, period, format, recipients.

**StatutoryCalculation** — an executed calculation with inputs, rule versions, intermediates and
result. Immutable.

---

# End of service

Support, as configuration and never as code:

Accrual by service band, with different fractions per band.

Distinct treatment by termination reason — resignation, dismissal, end of contract, death,
disability, retirement — including the reduced entitlements some laws apply to resignation
within service thresholds.

Wage base definition: which components are included, which excluded.

Service period computed on the calendar the country's law specifies, in whole days.

Unpaid leave and suspension treatment.

Caps, offsets and previously paid settlements.

Accrued provision reported per period, so the liability is visible before it is paid.

Immediate recomputation on any retroactive change to service or wage base.

---

# Social insurance

Support, as configuration:

Multiple schemes per country and per population.

Different treatment for nationals and non-nationals, including populations that are exempt.

Wage base composition, floors and ceilings.

Employee and employer rates, including hazard and occupational classes.

Mid-period joining, leaving and rate changes.

Registration, contribution and settlement files.

Reconciliation between what was computed and what the authority billed.

---

# Wage protection and payment files

Support configurable payment file generation, validated before submission, with a submission
record, an acknowledgement record and a discrepancy report. Formats are pack data. Transmission
belongs to Phase 22.

---

# Country pack deliverables

Each pack delivers: working week and holidays; statutory leave entitlements and eligibility;
end of service rules; social insurance schemes; tax rules where applicable; payment file
formats; statutory reports; document types and identifier validation; and golden-case tests
covering every one of them.

Priority 1 — Saudi Arabia, Jordan, United Arab Emirates.

Priority 2 — Kuwait, Qatar, Egypt, Oman, Bahrain.

---

# Validation rules

Pack version effective ranges must not overlap or leave gaps. Every rule cites a source. Every
scheme defines its wage base. Every format validates before generation. Every calculation
records its rule versions. No pack activates without passing its golden cases.

---

# Acceptance criteria

✓ Statutory behaviour resolves entirely through packs; no country logic in any business module

✓ Packs versioned with effective dates; historical results reproducible exactly

✓ Every statutory figure explains its rule, version and inputs

✓ End of service correct across every termination reason and service band, per country

✓ Social insurance correct for nationals and non-nationals, including mid-period changes

✓ Payment files validate and are accepted in the target format

✓ Golden-case suites pass for all Priority 1 countries, citing published sources

✓ Adding a Priority 2 country requires no change to any business module

✓ Quality gates pass

---

# Definition of Done

A tenant in Saudi Arabia, Jordan or the UAE can run a first payroll that is statutorily correct,
produce a compliant payment file, compute end of service for any leaver, and reconcile social
insurance — with no country-specific code in any business module.
