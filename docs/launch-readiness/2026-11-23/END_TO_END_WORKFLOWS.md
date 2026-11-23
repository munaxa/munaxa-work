# End-to-end workflows

Each workflow was traced through schema, routes, authorization, screens and tests at `61c115b`. No
workflow was executed against a running API in this session (the `@munaxa/*` packages could not be
installed, AUDIT_EVIDENCE.md §6); the backend behaviour stated below is what the module suites assert,
and they passed in CI run 44901535832.

**The common finding across all ten:** every step that creates or changes data is API-only. The admin
portal can display the result of most steps but cannot perform any of them (MW-011). A normal user
cannot complete any workflow without direct API calls, and in Testing the API documentation is off
(`OPENAPI_ENABLED = "false"` in `munaxa-platform/infra/aws/stack/services.tf`), so testers also need a
client and a published OpenAPI file (MW-004).

Legend: ✅ exists and tested · ⚠️ exists with a gap · ❌ missing.

## A. Organization setup

| Step                                       | Backend                                   | Screen          | Notes                                                                                                 |
| ------------------------------------------ | ----------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| Create the organization (tenant)           | ⚠️ `scripts/bootstrap-tenant.mjs` only    | ❌              | No tenant table and no tenant API; a tenant exists through its binding and first membership (MW-005, MW-044) |
| Units of any depth, unit types             | ✅                                        | read-only tree  |                                                                                                       |
| Legal entity with country and currency     | ✅ (ADR-0035)                             | read-only       | Country decides statutory rules; no pack exists                                                       |
| Locations                                  | ❌ by decision (ADR-0041)                 | ❌              | Work location is not modelled; the schedule owns the time zone                                        |
| Positions and establishment                | ✅                                        | ❌              |                                                                                                       |
| Calendars, working week, holidays          | ✅ structure, ❌ content                  | ❌              | Tenant must enter Jordan's holidays (MW-030)                                                          |
| Policies (leave, attendance, payroll)      | ✅ per module                             | read-only       |                                                                                                       |
| Permissions and roles                      | ❌ in Work; roles live in Identity        | ❌              | Only two staging roles exist (MW-003); no role administration screen anywhere in Work                 |

**Gap:** the first tenant requires an operator with database access and three systems (Work, Identity,
Control) to be configured by hand in the right order.

## B. Employee lifecycle

| Step                                       | Backend | Screen                  | Notes                                                                       |
| ------------------------------------------ | ------- | ----------------------- | --------------------------------------------------------------------------- |
| Create person, duplicate check             | ✅      | ❌ (list only)          | Keyed digest comparison                                                     |
| Profile: names, identifiers, contacts      | ✅      | read-only record        | Identifiers stored in clear text (MW-024)                                   |
| Employment, assignment, manager, contract  | ✅      | read-only record        |                                                                             |
| Documents and expiry                       | ⚠️      | ❌                      | No file bytes (MW-014); expiry reminders never sent (MW-015, MW-016)        |
| History                                    | ✅      | read-only               | Effective dating, append-only history tables                                |
| Status change, termination                 | ⚠️      | ❌                      | `end_reason_code` exists; no separation process or settlement (MW-019)      |

## C. Recruitment

Requisition (approval through Workflow, ✅) → vacancy ✅ → candidate ✅ (a candidate is not a person,
ADR-0044) → application pipeline ✅ → interviews and feedback ✅ → offer ✅ → hire saga ✅ creating Person
and Employment. Gaps: no careers page or candidate portal, no email to candidates or interviewers
(MW-015), no CV storage (MW-014), offer approval is not routed through Workflow (MW-017), write UI
missing.

## D. Onboarding

Plans and immutable versions ✅ → start for an employment ✅ **by command**, not automatically on hire
(ADR-0050) → tasks with owners and due dates ✅ → completion, including `onboarding.task.complete-own`
by the employee ✅ (enforced, but no portal screen) → reconciliation finds joiners without an
onboarding ✅. Gaps: nobody is told a task is due (MW-015), due dates are not escalated (MW-016),
document collection has no storage (MW-014).

## E. Attendance

Rules and policies ✅ → shifts, schedules, rosters ✅ → raw events ✅ (imports; `attendance.event.record-own`
is declared but no handler enforces it, so an employee cannot punch) → calculated day and exceptions ✅
→ corrections that never rewrite a punch ✅ → frozen payable snapshot read by Payroll ✅. Gaps: no
device, kiosk or mobile capture; overtime minutes are candidates only and never paid (MW-021);
recalculation after a leave change happens only when the reconciliation is run (ADR-0058, MW-016).

## F. Leave

Types and versioned policies ✅ → entitlement ✅ → request with per-date breakdown ✅ (on behalf of an
employee; `leave.request-own` declared and unenforced) → approval by a named human, self-approval refused
in code and by a check constraint ✅ → ledger and balance ✅ → attendance pulls approved leave ✅ →
payroll reads unpaid minutes through `leave.payroll-period` ✅. Gaps: no statutory entitlements (Jordan
annual, sick, maternity and other leave must be configured by the tenant and verified, MW-030); no
employee request screen (MW-013); no approval notification (MW-015); approval is module-local, so no
delegation or escalation (MW-017); accrual and year-end run only when called (MW-016).

## G. Compensation

Components, plans, salary structure ✅ → employee recurring and one-time amounts, effective-dated,
overlap refused by a GiST exclusion ✅ → adjustments with a written reason ✅ → set-based contract for
Payroll ✅. Deductions are deliberately not here: tenant-defined payroll deductions live in Payroll;
statutory deductions do not exist (MW-010); loan recovery does not exist (MW-020).

## H. Payroll

Groups and calendars ✅ → periods ✅ → run with a resumable cursor ✅ → snapshot per employment ✅ →
earnings, tenant-defined deductions, proration for mid-period joiners and unpaid leave ✅ → exceptions
and adjustments with reasons ✅ → approval by a named human, not the requester ✅ → finalization,
immutable at the table ✅ → reversal and reconciliation ✅ → accounting lines and payment instructions
✅ (no bank account identifier by design). Gaps: no statutory deductions or employer contributions
(MW-010), no payslip document or employee access (MW-018, MW-013), no bank file (MW-018), no loans
(MW-020), no final settlement (MW-019), overtime unreachable (MW-021). See PAYROLL_JORDAN_READINESS.md.

## I. Approvals

| Capability                          | Workflow engine (Recruitment requisitions) | Leave, payroll, letters, compensation |
| ----------------------------------- | ------------------------------------------ | ------------------------------------- |
| Multi-step, parallel, quorum        | ✅                                         | ❌ single step                         |
| Delegation                          | ✅ (Identity delegations)                  | ❌                                     |
| Manager routing                     | ✅                                         | ❌ (any holder of the permission)      |
| Service level, escalation, reminder | ✅ when invoked, no scheduler              | ❌                                     |
| Rejection and cancellation          | ✅                                         | ✅                                     |
| Self-approval refused               | ✅                                         | ✅ (code and check constraints)        |
| Append-only audit history           | ✅ (triggers)                              | ✅ per module                          |
| Notification                        | ❌ recorded, not delivered                 | ❌                                     |
| Queue screen                        | ✅ read-only (`/approvals`)                | ❌                                     |
| Deciding from a screen              | ❌                                         | ❌                                     |

**Gap:** two approval systems and no way to decide from the UI (MW-011, MW-017).

## J. Employee and manager self-service

| What an employee or manager can do today | How                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Sign in                                  | Identity sign-in on `work.<env>`; the admin reads the session cookie                     |
| See their approval queue                 | `/approvals` in the **admin** (the `workflow.approval.read-own` queue), read-only        |
| Complete their own onboarding task       | API only (`onboarding.task.complete-own`)                                                |
| See payslip, balance, request leave, punch, read own documents, request a letter | **Nothing.** Declared `-own` permissions with no enforcing handler; portals are bootstrap pages |

**Conclusion:** there is no self-service product (MW-013).

## Integration and consistency gaps found while tracing

- Onboarding does not start on hire unless someone runs the command (by design, ADR-0050); without a
  scheduler the reconciliation that catches this also never runs by itself (MW-016).
- Assets publishes an offboarding clearance contribution that nothing consumes (MW-019).
- `identity.primary-employment-for-membership` answers "which employment is this user", so `-own` reads
  are architecturally possible today; they are blocked by missing handlers, not by a missing capability.
- Audit history is per module; there is no single view of who changed what for one employee (MW-026).
