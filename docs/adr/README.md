# Architecture Decision Records

ADR-0001 to ADR-0020 are the founding decisions, recorded in
[`work prompts/26_ARCHITECTURE_DECISION_RECORDS.md`](../../work%20prompts/26_ARCHITECTURE_DECISION_RECORDS.md).
Every decision made from implementation onward is recorded here as its own file, numbered
from ADR-0021.

An ADR is never modified silently. A superseded ADR keeps its file and gains a `Superseded by`
line; the decision that replaced it is a new record.

| ADR                                              | Title                             | Status   |
| ------------------------------------------------ | --------------------------------- | -------- |
| [0021](0021-engineering-standards-enforcement.md) | Engineering standards enforcement | Accepted |
| [0022](0022-master-instructions-enforcement.md)   | Master instructions enforcement   | Accepted |
| [0029](0029-ecosystem-file-naming.md)             | File naming follows the ecosystem | Accepted |
| [0030](0030-tenant-isolation.md)                  | Tenant isolation                  | Accepted |
| [0031](0031-android-host-project.md)              | The Android host project          | Accepted |
| [0032](0032-tenant-resolution-from-membership.md) | Tenant resolution from membership | Accepted |
| [0033](0033-tenant-less-workforce-user.md)        | The tenant-less workforce user    | Accepted |
| [0034](0034-hierarchy-as-typed-nodes.md)          | The hierarchy is one node table, not nine | Accepted |
| [0035](0035-country-from-legal-entity.md)         | A country belongs to a legal entity, never a tenant | Accepted |
| [0036](0036-tenant-settings-owned-by-organization.md) | Tenant settings owned by Organization | Accepted |
| [0037](0037-legal-name-is-effective-dated.md)    | A person's legal name is effective-dated; every other attribute is not | Accepted |
| [0038](0038-personal-data-protection.md)         | How personal data is protected in People | Accepted |

Every ADR states: decision, reason, consequences, alternatives considered, date, author and
approval status.
