# Documents

**Documents says what evidence exists about somebody, and who has looked at it.**

Phase 12. Five tables. Package `@work/documents`.

It holds **no bytes**. `storage_reference` is an opaque key, `StoragePort` has no adapter anywhere
in this repository, and this module never sees a file's content. That is the single most important
sentence about it, and everything below is consistent with it.

---

## What it owns

Document types — what a tenant calls a kind of document; documents, as stable identities filed
against a person, an employment or a legal entity; **insert-only versions**, each addressing bytes
this module does not hold; verification decisions attached to a *version*; and a queryable
**access trail** recording who reached which document, when, and with what outcome.

## What it does not own, and why

| Absent | Where it belongs | Why |
| --- | --- | --- |
| File content, upload, download, retrieval | Storage | `StoragePort` has no implementer. `storageUnavailable` answers `available: false` and never a fabricated URL |
| Content inspection, malware scanning, hash verification | Storage | All three require reading the bytes. `hash_verified` is false on every row and the view says so |
| A passport's number, issuing country or expiry | People | Where a document evidences an identifier, People owns the facts and this module stores the identifier's id and nothing else (D-1a) |
| The person, the employment, the legal entity | Their own modules | Confirmed through published contracts under a bounded service grant; there is no foreign key, because a polymorphic reference cannot carry one |
| Retention periods | Country packs and GRC | `retention_policy_code` is opaque and is never interpreted here (D-11) |
| Notice and escalation delivery | A scheduler that does not exist | Thresholds are configured; nothing fires them (D-26) |
| Dependents | Nowhere in this repository | `dependent` is reserved and refused. Reserving the word without a subject would invite a second person registry inside Documents (D-1) |
| Permanent deletion | Not this phase | There is no transition to a deleted state and no method that could reach one (D-10) |
| Mandatory-document detection | Deferred | No table, no query, no partial implementation (D-27) |

---

## The four decisions that carry the module

### The document is stable; the versions are insert-only

A document has one identity for its whole life. Replacing the file adds a version and stamps the
previous one superseded; nothing rewrites a version, ever. `VersionStore` has no `update` and no
`remove`, the repository extends nothing that would provide them, and a trigger refuses both from
any path including SQL nobody wrote in TypeScript.

The **one** permitted touch is `superseded_at`, moving from null to a value with every other column
byte-for-byte identical. That exception was missing from the original migration and made adding a
second version impossible; `20260811140000_document_version_supersede` narrowed the rule rather than
relaxing it.

### There is one authoritative answer to when a passport expires, and it is not here (D-1a)

Where a document evidences a `person_identifier`, People owns the expiry and this module stores none
of its own. A check constraint refuses a row carrying both. The view reports People's date and sets
`expiryOwnedByPeople`, so a screen can say where the date came from — a date whose owner is
ambiguous is a date somebody edits in the wrong place.

### Confidentiality is applied in the query, never after it

A caller without `document.read-sensitive` does not receive confidential documents **and does not
learn how many were withheld**. The predicate is in the SQL, so the row never leaves the database
and the total agrees with the rows. A count is itself a disclosure: "this employee has three medical
documents" is the thing the classification was protecting.

A confidential document is reported **not found**, never forbidden. "Forbidden" on a document
identifier confirms that a document of that kind exists for that employee.

### Reading is recorded, and so is being refused

`document_access_event` is a table, not a log line, because an unqueryable HR access trail cannot
answer a subject access request (D-23). Metadata reads are recorded as well as downloads — recording
only downloads would leave "who has been looking at this employee" unanswerable. `download_refused`
is on the list deliberately: somebody trying repeatedly to reach a document they may not see is
exactly what an access trail exists to surface.

---

## Permissions

| Permission | Reaches |
| --- | --- |
| `document.type.read` / `document.type.manage` | The configured kinds of document |
| `document.read` | That a document exists, its type, status and expiry. **Not its contents and not its bytes** |
| `document.read-sensitive` | A document whose type is classified confidential. Additional to `read`, never instead of it |
| `document.download` | Obtaining a URL for the bytes. Separate from reading the metadata |
| `document.manage` | Filing, replacing, archiving, legal hold, reconciliation |
| `document.verify` | Deciding whether a version is what it claims to be |
| `document.audit` | The access trail. Itself a sensitive read |
| `document.read-own` | **Declared; enforced nowhere.** No authenticated-principal-to-employment resolution exists (ADR-0032) |

---

## What is `NOT VERIFIED`

Binary storage, upload, download, content inspection, malware scanning, hash verification, notice
firing, employee self-service routing, and reconciliation's two storage checks. Each is a missing
dependency named exactly, not a shortcut. See
[`verification/phase-12-report.md`](../verification/phase-12-report.md) §5.
