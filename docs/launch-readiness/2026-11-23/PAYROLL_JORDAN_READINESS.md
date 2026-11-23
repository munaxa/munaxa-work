# Payroll engine status and Jordan Pilot Payroll Gap Assessment

Baseline `61c115b`. Specification reference: `work prompts/12A_PHASE_11.1_STATUTORY_COUNTRY_PACKS.md`.

> **Bottom line.** Munaxa Work has a sound, generic payroll **engine** and **no Jordanian payroll
> product**. Nothing in the repository calculates social security, income tax, end of service or any
> other Jordanian statutory figure. It must **not** be used to pay real employees in Jordan until a
> Jordan pack exists, every rule cites a verified source, golden cases written from those sources pass,
> and qualified Jordanian payroll and legal specialists have signed off.
>
> This document deliberately states **no** rates, thresholds, ceilings, brackets or entitlements. Every
> statutory value must come from the research described in §4, not from this audit or from memory.

## 1. What the engine does today (verified in code; tests passed in CI 44901535832)

| Capability                            | State | Evidence                                                                                                                                        |
| ------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Payroll groups, pay calendars, periods | ✅    | `packages/modules/payroll/src/domain/payroll-group.ts`, `api/` (28 routes)                                                                      |
| Runs from an immutable snapshot       | ✅    | ADR-0064; `domain/payroll-snapshot.ts:123-148` (snapshot and its digest)                                                                        |
| Earnings from compensation            | ✅    | recurring and one-time components (Compensation contract)                                                                                       |
| Proration (mid-period join, leave)    | ✅    | `domain/proration.ts` (presence first, then unpaid leave on the prorated amount)                                                                |
| Tenant-defined deductions             | ✅    | `deduction-definitions` routes; `domain/deductions.ts`                                                                                          |
| Explainable lines                     | ✅    | every line carries a calculation reason (`domain/payroll-lines.ts`)                                                                             |
| Money and rounding                    | ✅    | integer minor units with exponent (ADR-0061); rounding modes as data (`domain/payroll-vocabulary.ts:181`); JOD exponent 3 in fixtures and tests |
| Exceptions, manual adjustments        | ✅    | adjustments need a written reason                                                                                                               |
| Approval by a named human, not the requester | ✅ | `domain/payroll-approval.ts:54` refuses self-approval; a check constraint repeats it in the database                                       |
| Finalization immutable at the table   | ✅    | ADR-0066, trigger                                                                                                                               |
| Reversal and reconciliation           | ✅    | reconciliation is a pull, not dependent on events                                                                                               |
| Accounting output                     | ✅    | balanced lines against opaque tenant codes; nothing posted (ADR-0067)                                                                           |
| Payment instructions                  | ⚠️    | prepared, **no bank account identifier, no bank domain, no file format** (`domain/payroll-outputs.ts:9-12`)                                     |
| Payslip                               | ⚠️    | payslip **data** route only (`GET /payroll/results/:id/payslip`); no document; employee access (`payroll.read-own`) unenforced                    |
| Overtime                              | ❌    | Attendance publishes candidate minutes; `attendance_overtime` is "declared and unreachable" (`domain/earnings.ts:23-25`, ADR-0065)              |
| Statutory deductions and contributions | ❌   | `payroll.composition.ts:93-95` wires `noCountryRules`; `packages/country-packs/src/index.ts` exports nothing                                    |
| End of service, final settlement      | ❌    | Phase 11.2 not started                                                                                                                          |
| Loans and advances                    | ❌    | Phase 10.1 not started                                                                                                                          |
| Effective-dated statutory rules       | ❌    | no rule tables, no pack versions                                                                                                                |
| Golden cases citing legal sources     | ❌    | none                                                                                                                                            |
| Statutory reports                     | ❌    | none                                                                                                                                            |

### The country rule seam and its limits

`packages/modules/payroll/src/domain/country-rule.ts` and `country-rule-application.ts` define how a
pack's lines are appended (a pack adds statutory lines; it cannot edit contractual ones; a statutory net
floor reduces deductions in priority order). The design is good. Three limits must be fixed before a
Jordan pack can be correct:

1. **No year-to-date or prior-period figures** reach the port (`CountryRuleInput`: country, period,
   snapshot, currency, this period's earnings, deductions and gross). Annual income tax computed per
   month, and any annual contribution ceiling, normally need cumulative figures.
2. **No personal facts.** `EmploymentSnapshot` holds employment, compensation, attendance and leave
   facts only (`payroll-snapshot.ts:20-35,123-130`). Nationality, residency, birth date and other facts
   that eligibility rules depend on (12A AD-005) are not captured.
3. **Synchronous and stateless.** `CountryRulePort.apply` returns a value synchronously, so a pack cannot
   load versioned rate tables per date at run time unless they are preloaded into the snapshot. The
   kernel rule engine (`packages/kernel/src/rules/rule-engine.ts`) that 12A AD-006 asks for is unused by
   any module.

## 2. Classification for the Jordan Pilot

| Capability                                                                                 | Internal Testing with synthetic data | Real Jordanian customer payroll                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------- |
| Configure groups, periods, components, tenant deductions                                   | ✅ usable                            | ✅ usable after write UI                            |
| Gross pay from salary and allowances, proration, unpaid leave                              | ✅ usable                            | ⚠️ only after proration rules are verified against Jordanian practice |
| Run, review, approve, finalize, reverse                                                    | ✅ usable                            | ✅ mechanics usable                                  |
| Net pay                                                                                    | ✅ for engine testing                | ❌ **must not be used**: no statutory deductions    |
| Employer cost and contributions                                                            | ❌                                   | ❌                                                  |
| Payslip shown to the employee                                                              | ❌                                   | ❌                                                  |
| Paying employees (bank file)                                                               | ❌                                   | ❌                                                  |
| End of service, final settlement                                                           | ❌                                   | ❌                                                  |
| Statutory filings and reports                                                              | ❌                                   | ❌                                                  |

**Allowed for internal testing:** everything marked usable, with synthetic employees, synthetic salaries
and tenant-defined deductions that stand in for statutory ones. Results must be labelled "not statutory"
in any screen or export a tester shows outside the team.

**Not allowed for any real payroll:** net pay, contributions, tax, end of service and any document an
employee or authority would rely on, until §4 and §5 are complete.

## 3. Jordan gap list

| Area                         | Gap                                                                                                                       | Backlog |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| Social security              | No scheme, eligibility, wage base, employee or employer rate, ceiling, or registration and contribution report             | MW-010  |
| Income tax                   | No tax rules, exemptions, annual or cumulative computation, or withholding report                                         | MW-010  |
| Other statutory items        | Any other mandatory contribution or deduction that applies must be identified by research; none is modelled               | MW-010  |
| Employee statutory eligibility | No nationality, residency or age facts in the payroll snapshot                                                          | MW-010  |
| End of service and settlement | Not built; termination reasons exist on employment only as a code                                                        | MW-019  |
| Overtime                     | Unreachable by design; rates and eligibility must come from the Labour Law research                                       | MW-021  |
| Leave entitlements           | None ship (ADR-0060); annual, sick and other statutory leave must be researched and configured as pack data               | MW-030  |
| Working week and holidays    | None ship; tenant-entered                                                                                                  | MW-030  |
| Minimum wage                 | No check                                                                                                                  | MW-010  |
| Payment of wages             | No bank account data, no bank or electronic wage payment file                                                              | MW-018  |
| Payslip                      | No document, no employee access, no Arabic payslip layout                                                                  | MW-018, MW-013 |
| Loans and advances           | Not built; any legal limit on deductions from wages must be researched                                                    | MW-020  |
| Effective dating and history | Generic engine snapshots are effective-dated; statutory rule versions do not exist                                        | MW-010  |
| Historical recalculation     | Reversal and rerun exist; reproducing an old run requires versioned rules (12A AD-002)                                   | MW-010  |
| Rounding                     | Modes exist as data; statutory rounding per rule must be researched (12A AD-008)                                           | MW-010  |
| Audit trail                  | Run, approval and finalization history exist; read access to payroll is not logged                                       | MW-026  |
| Legal source traceability    | Lines can carry `statutorySourceCode`; no source catalogue exists                                                         | MW-010  |
| Golden cases                 | None                                                                                                                      | MW-010  |

## 4. Research that must be done by qualified Jordanian specialists before any rule is coded

The owner should commission a Jordanian payroll accountant and a labour and data protection lawyer to
produce a written, dated, source-cited specification for each item below. Implementation agents must
code only from that specification.

1. **Social security** (Social Security Corporation): which employees are covered (including
   non-Jordanians and part-time staff), insurance branches, employee and employer rates, the wage base and
   which components it includes, minimum and maximum insurable wage, mid-month joining and leaving,
   registration and monthly contribution submission, rounding, and how rates have changed over time.
2. **Income tax** (Income and Sales Tax Department): resident and non-resident treatment, personal and
   family exemptions and their evidence, brackets, any additional contribution levied with income tax,
   whether withholding is monthly on an annualised or cumulative basis, year-end reconciliation, the
   withholding return and its format, rounding.
3. **Labour Law obligations:** working hours, overtime and holiday work rates, weekly rest, public
   holidays, annual, sick, maternity and other leave entitlements, notice, end of service and the
   treatment of each termination reason, minimum wage, permitted deductions from wages and their limits.
4. **Payment of wages:** whether employers must pay electronically or through specific channels, any
   bank file standards the pilot customers' banks require, and record-keeping duties.
5. **Personal data protection:** obligations for processing employee data, retention periods for
   payroll and personnel records, cross-border transfer (the stack runs in AWS `eu-central-1`), and
   employee rights.
6. **Reports:** every periodic statutory report and its format.

Each item must state its legal source, effective date and the person who verified it. Changes over time
must be captured as separate effective-dated versions.

## 5. What implementation must deliver (Jordan pack definition of done)

- Rule data, not code, per 12A AD-001 to AD-009: versioned, effective-dated, each rule citing its
  source.
- Port extensions: year-to-date figures, person facts and an asynchronous rule source (MW-010).
- Golden cases written by the specialists, covering joiners, leavers, ceilings, nationals and
  non-nationals, exemptions, rounding and at least one historical rate change; CI fails if any differs.
- Payslip in Arabic and English; bank file for each pilot bank; statutory reports.
- A parallel run: at least two months of a pilot customer's real payroll calculated in both their
  current system and Munaxa Work, with every difference explained, before Munaxa Work is the system of
  record.
- Owner and specialist sign-off recorded in the repository.
