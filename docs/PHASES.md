# Implementation ledger

Phases are implemented strictly in order. No phase begins before the previous one satisfies
its acceptance criteria, and skipping a phase is prohibited. Each phase follows
[`work prompts/27_DEVELOPMENT_PROTOCOL.md`](../work%20prompts/27_DEVELOPMENT_PROTOCOL.md) and
ends by stopping for approval.

This ledger is the record of where the product actually is. A phase moves to **Complete** only
when its definition of done is met — CI green, production build passing, documentation and
ADRs updated.

| #   | Phase                       | Specification                                                                                      | Status      |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------- | ----------- |
| —   | Engineering standards       | [`00_ENGINEERING_STANDARDS.md`](../work%20prompts/00_ENGINEERING_STANDARDS.md)                        | Adopted     |
| —   | Master instructions         | [`00_MASTER_INSTRUCTIONS.md`](../work%20prompts/00_MASTER_INSTRUCTIONS.md)                            | Adopted     |
| 0   | Repository bootstrap        | [`01_PHASE_0_WORK_BOOTSTRAP.md`](../work%20prompts/01_PHASE_0_WORK_BOOTSTRAP.md)                      | Not started |
| 1   | Foundation                  | [`02_PHASE_1_FOUNDATION.md`](../work%20prompts/02_PHASE_1_FOUNDATION.md)                              | Not started |
| 1.1 | Architecture verification   | [`02A_PHASE_1.1_ARCHITECTURE_VERIFICATION.md`](../work%20prompts/02A_PHASE_1.1_ARCHITECTURE_VERIFICATION.md) | Not started |
| 2   | Workforce identity          | [`03_PHASE_2_WORKFORCE_IDENTITY.md`](../work%20prompts/03_PHASE_2_WORKFORCE_IDENTITY.md)              | Not started |
| 3   | Organization                | [`04_PHASE_3_ORGANIZATION.md`](../work%20prompts/04_PHASE_3_ORGANIZATION.md)                          | Not started |
| 4   | People master registry      | [`05_PHASE_4_PEOPLE_MASTER_REGISTRY.md`](../work%20prompts/05_PHASE_4_PEOPLE_MASTER_REGISTRY.md)      | Not started |
| 5   | Employment                  | [`06_PHASE_5_EMPLOYMENT.md`](../work%20prompts/06_PHASE_5_EMPLOYMENT.md)                              | Not started |
| 6   | Recruitment                 | [`07_PHASE_6_RECRUITMENT.md`](../work%20prompts/07_PHASE_6_RECRUITMENT.md)                            | Not started |
| 7   | Onboarding                  | [`08_PHASE_7_ONBOARDING.md`](../work%20prompts/08_PHASE_7_ONBOARDING.md)                              | Not started |
| 8   | Attendance                  | [`09_PHASE_8_ATTENDANCE.md`](../work%20prompts/09_PHASE_8_ATTENDANCE.md)                              | Not started |
| 9   | Leave                       | [`10_PHASE_9_LEAVE.md`](../work%20prompts/10_PHASE_9_LEAVE.md)                                        | Not started |
| 10  | Compensation                | [`11_PHASE_10_COMPENSATION.md`](../work%20prompts/11_PHASE_10_COMPENSATION.md)                        | Not started |
| 11  | Payroll engine              | [`12_PHASE_11_PAYROLL_ENGINE.md`](../work%20prompts/12_PHASE_11_PAYROLL_ENGINE.md)                    | Not started |
| 12  | Benefits                    | [`13_PHASE_12_BENEFITS.md`](../work%20prompts/13_PHASE_12_BENEFITS.md)                                | Not started |
| 13  | Performance                 | [`14_PHASE_13_PERFORMANCE.md`](../work%20prompts/14_PHASE_13_PERFORMANCE.md)                          | Not started |
| 14  | Learning                    | [`15_PHASE_14_LEARNING.md`](../work%20prompts/15_PHASE_14_LEARNING.md)                                | Not started |
| 15  | Career and succession       | [`16_PHASE_15_CAREER_SUCCESSION.md`](../work%20prompts/16_PHASE_15_CAREER_SUCCESSION.md)              | Not started |
| 16  | Workflow                    | [`17_PHASE_16_WORKFLOW.md`](../work%20prompts/17_PHASE_16_WORKFLOW.md)                                | Not started |
| 17  | Communications              | [`18_PHASE_17_COMMUNICATIONS.md`](../work%20prompts/18_PHASE_17_COMMUNICATIONS.md)                    | Not started |
| 18  | Employee self service       | [`19_PHASE_18_EMPLOYEE_SELF_SERVICE.md`](../work%20prompts/19_PHASE_18_EMPLOYEE_SELF_SERVICE.md)      | Not started |
| 19  | Manager self service        | [`20_PHASE_19_MANAGER_SELF_SERVICE.md`](../work%20prompts/20_PHASE_19_MANAGER_SELF_SERVICE.md)        | Not started |
| 20  | Workforce intelligence      | [`21_PHASE_20_WORKFORCE_INTELLIGENCE.md`](../work%20prompts/21_PHASE_20_WORKFORCE_INTELLIGENCE.md)    | Not started |
| 21  | Governance, risk, compliance| [`22_PHASE_21_GOVERNANCE_RISK_COMPLIANCE.md`](../work%20prompts/22_PHASE_21_GOVERNANCE_RISK_COMPLIANCE.md) | Not started |
| 22  | Enterprise integrations     | [`23_PHASE_22_ENTERPRISE_INTEGRATIONS.md`](../work%20prompts/23_PHASE_22_ENTERPRISE_INTEGRATIONS.md)  | Not started |
| 23  | AI workforce intelligence   | [`24_PHASE_23_AI_WORKFORCE_INTELLIGENCE.md`](../work%20prompts/24_PHASE_23_AI_WORKFORCE_INTELLIGENCE.md) | Not started |
| 24  | Enterprise operations       | [`25_PHASE_24_ENTERPRISE_OPERATIONS.md`](../work%20prompts/25_PHASE_24_ENTERPRISE_OPERATIONS.md)      | Not started |

**Status values** — Not started · In progress · Awaiting approval · Complete.

The two governance documents are marked *Adopted*: they are not phases, they are the rules
every phase is measured against. They are in force from now on, and they are enforced by the
gates listed in [`MASTER_INSTRUCTIONS.md`](MASTER_INSTRUCTIONS.md).
