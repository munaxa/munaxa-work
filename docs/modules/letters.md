# Letters

**Letters says what this employer stated about somebody, and freezes it.**

Phase 12. Six tables. Package `@work/letters`.

It **renders nothing**. No PDF library, renderer or headless browser exists in this repository, so
an issued letter carries its content and no artefact. The part that is owned is the part that is
reproducible.

---

## What it owns

Letter templates a tenant authors; **immutable template versions**, frozen the moment one issues a
letter; letter requests and their lifecycle; named-human approval decisions; issued letters with
their **frozen substituted values and source versions**; and a tenant-scoped, gapless reference
counter.

## What it does not own, and why

| Absent | Where it belongs | Why |
| --- | --- | --- |
| Any letter type | A tenant or a country pack | An employment certificate, a salary certificate and an embassy letter are all rows a customer writes. There is no endpoint per letter type and no letter type in this module's code (5.1 AD-001) |
| PDF rendering | A document renderer that does not exist | `document_id` is null on every issued letter (D-15) |
| Electronic signature | A signature provider that does not exist | `signature_state` has no `signed` value. A letter may record that one is *required*; nothing claims one occurred (D-16) |
| Approval routing and escalation | Workflow (Phase 16) | Decisions are recorded in this module's own table, shaped to `ApprovalPort`'s view so Phase 16 changes the source and not the contract (D-14) |
| The person, employment, employer and salary | Their own modules | Read through published contracts under bounded service grants at the moment of generation, then **frozen** |
| The employee-relations record a disciplinary letter belongs to | Employee Relations (5.2) | Phase 12 renders the letter; the record is not this module's (D-18) |

---

## The four decisions that carry the module

### A variable is a name, and substitution is a lookup

`[a-z][A-Za-z0-9]*` with up to three dotted segments. **No expression language, no operator, no
function call, no loop.** That narrowness is the entire safety model: a tenant authors the template,
and the template is executed against another employee's salary. Every placeholder a body uses must
be a *declared* variable, checked when the version is authored — so a typo is refused for the person
who wrote it instead of failing for the employee who asked.

### An unresolved variable fails the letter

A source that cannot be asked is an **outage**, not "no facts". Rendering a blank where a salary
belongs is how a bank letter comes to state that an employee earns nothing, over the employer's
name. An unwired source, an unavailable source and an unresolved name are all refusals.

### Everything is frozen at issue (the ADR-0064 argument, applied to letters)

The template version, every substituted value, the locale, and the version of each source the values
came from. A salary certificate issued in March still reads March's salary after April's raise,
because nothing re-reads a source after issue. A correction is a **new** letter that supersedes the
original — somebody may be holding a printed copy of it, so the original is never edited.

A template version freezes on **issuance, not publication**. A published version that has issued
nothing is still editable, because nothing depends on it yet.

### Salary needs two gates (5.1 AD-005)

The template must declare `salary` in its exposed fields **and** the issuer must hold
`letter.include-salary`. Without the second, a letter becomes a way to read a salary the caller
could not read directly: anybody who may request an employment certificate could request one whose
template happens to print a figure.

---

## Permissions

| Permission | Reaches |
| --- | --- |
| `letter.template.read` / `letter.template.manage` | Authoring the letters a tenant may issue |
| `letter.read` | The register, the requests and what an issued letter said |
| `letter.request` | Asking for a letter |
| `letter.include-salary` | Issuing a template that exposes pay. Additional to `request`, never instead of it |
| `letter.approve` | Deciding on a request. Self-approval is refused three times over |
| `letter.issue` | Generating and issuing |
| `letter.verify` | Confirming a reference is genuine, and nothing else about it |
| `letter.manage` | Reconciliation |
| `letter.request-own` | **Declared; enforced nowhere.** No self-service routing exists (ADR-0032) |

---

## Third-party verification

A bank holding a printed letter can confirm it is genuine and current. It learns the reference, the
issue date in both calendars and whether the letter has been superseded — **no name, no employer, no
salary, no purpose** (5.1 AD-006). A wrong token answers `genuine: false` and nothing else, because
"no such letter" over enough attempts would let somebody enumerate the register.

The token comes from `randomBytes(32)` and is never the reference number, which is sequential and
printed on the letter. The verification query takes the token in a request **body**, not a path: a
token in a URL ends up in a proxy log, a browser history and a referrer header.

**The anonymous public route is `NOT VERIFIED`.** Every read in this product resolves a tenant before
it reaches a row and row-level security has no anonymous cross-tenant path, so the query declares
`letter.verify` rather than running unauthenticated. What it would sit behind is built and behaves
correctly; only the anonymous route is missing.

---

## What is `NOT VERIFIED`

PDF rendering, electronic signature, the anonymous verification route, and `payroll` as a variable
source. See [`verification/phase-12-report.md`](../verification/phase-12-report.md) §5.
