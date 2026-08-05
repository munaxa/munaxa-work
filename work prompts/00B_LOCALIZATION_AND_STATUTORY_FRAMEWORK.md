# 00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md

# Munaxa Work
## Localization & Statutory Framework

Version: 1.0

Status: Mandatory

---

# IMPORTANT

This document defines how Munaxa Work handles language, calendars, and the labor and social
insurance law of each country it operates in.

It applies to every phase. No phase may hardcode a country, a currency, a calendar, a
statutory rate, an entitlement or a government file format.

The architecture holds the abstraction. The **country pack** holds the law. Shipping the
abstraction without a country pack is shipping half a product: buyers in this market select on
statutory correctness, and a competitor that already computes end of service, social insurance
and wage protection files correctly wins on that alone.

---

# Language

Munaxa Work is bilingual from the first screen, not translated later.

Mandatory

Arabic and English are both first-class.

Every user-visible string comes from a translation catalogue.

Every catalogue key exists in both languages before a phase is done.

Users switch language at any time without losing state.

Language is a user preference, defaulted by tenant.

Forbidden

Hardcoded user-visible strings.

English-only enumerations rendered directly to users.

Concatenated sentences built from fragments — they cannot be translated correctly.

Layout that assumes text length or direction.

---

# Direction

Every screen supports RTL and LTR.

Direction follows language.

Mirroring applies to layout, navigation, icons with direction, charts, tables and PDF output.

Numerals, dates and currency follow locale formatting.

Arabic-Indic and Western numerals are both supported, selected by locale preference.

---

# Calendars

The system is calendar-aware, not Gregorian with a conversion utility bolted on.

Mandatory

Gregorian and Hijri (Umm al-Qura) are both supported for input and display.

Any date a user enters may be entered in either calendar.

Any date the system displays may be shown in either calendar, and in both simultaneously where
the business requires it — leave requests, contracts, letters and payslips do.

Conversion is a Shared Kernel capability implemented once, in Phase 1.

Storage is always a single instant in UTC. The calendar is a presentation and input concern.

The tenant configures the default calendar; the user may override it.

Fiscal, payroll, leave and service-period calculations state which calendar governs them, and
the choice is configuration, not code.

Forbidden

A Hijri implementation inside any business module.

Approximate conversion by arithmetic offset.

Assuming a 30-day month or a 365-day year in any statutory calculation.

---

# Country Pack

A **country pack** is the versioned, configurable unit that carries one country's statutory
behaviour. It is data and configuration first, and provider code only where a government
interface requires it.

A country pack owns

Working week and public holiday calendars.

Statutory leave entitlements, eligibility and limits.

End of service and gratuity rules.

Social insurance rules: contributor eligibility, wage base, employee and employer rates,
ceilings, and the treatment of nationals versus non-nationals.

Income tax rules where applicable.

Statutory payroll items and their treatment.

Payment file formats and wage protection requirements.

Government portal interfaces, isolated behind provider interfaces.

Statutory reports and their formats.

Identity document types and their validation.

Country packs are versioned with effective dates. A rate change is a new version, never an edit.
Historical payroll always recalculates against the version in force at the time.

Every country pack ships with golden-case tests: known employees, known periods, approved
expected outputs, reviewed against the published law.

Rules

No business module contains country logic.

No country pack contains business logic.

A tenant may operate in multiple countries at once.

An employment resolves its country pack from its legal entity, not from the tenant.

A person's nationality is an input to statutory rules and never a business rule in itself.

---

# Required country packs

The first release ships packs for the markets Munaxa Work sells into. Each is a deliverable of
`12A_PHASE_11.1_STATUTORY_COUNTRY_PACKS.md`.

Priority 1

Saudi Arabia — GOSI, wage protection through the national platform, end of service under the
Labor Law, national and non-national treatment, residency and permit document types.

Jordan — Social Security Corporation, income tax, end of service, labor law leave entitlements.

United Arab Emirates — pension and social security for nationals, wage protection file, end of
service gratuity.

Priority 2

Kuwait, Qatar, Egypt, Oman, Bahrain.

Every additional country is a configuration and content exercise, never a code change to a
business module. If a new country requires a business module to change, that is an architecture
defect and stops implementation.

---

# Statutory correctness

Anything statutory is treated as financial code.

Deterministic. Same inputs, same version, same outputs, always.

Versioned. Every rule set carries effective dates and is never edited in place.

Traceable. Every computed statutory figure explains which rule, which version and which inputs
produced it.

Tested. Golden cases before release, and a regression case for every defect.

Reviewed. A statutory change is reviewed against the published source, and the source is cited
in the change.

---

# Acceptance

A phase satisfies this framework when

✓ Every string is translated in both languages

✓ Every date input accepts both calendars

✓ Every screen renders correctly RTL and LTR

✓ No country, currency, rate, entitlement or format is hardcoded

✓ Statutory behaviour resolves through a country pack

✓ Golden-case tests exist for every statutory calculation the phase introduces

---

# End of Localization & Statutory Framework
