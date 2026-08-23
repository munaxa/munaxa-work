/**
 * What Employee Relations publishes.
 *
 * **Views only.** No handler, no store, no dependency type and no domain aggregate leaves this
 * module: a consumer that could reach a handler could bypass this module's permission checks, and
 * one that could reach a store could bypass its tenancy — which in this domain means bypassing the
 * access trail as well.
 *
 * **Nothing here carries a person.** A violation view names an employment and never a name, a
 * national identifier, a manager or an organisation. Those belong to People, Employment and
 * Organization, and a screen that needs one asks the module that owns it. A disciplinary view that
 * carried a name would be a directory of accused people.
 *
 * Contracts are versioned. A breaking change to anything here requires an ADR.
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

/**
 * One entry in a tenant's violation catalogue.
 *
 * `severity` is the tenant's own word, published as written. Nothing in this product interprets it,
 * orders by it, or infers a penalty from it — ordering is `sequence`, and it is here so a screen
 * lists the catalogue the way the tenant arranged it rather than alphabetically.
 *
 * `source` says which authority wrote the entry: `tenant` today, `country_pack` once Phase 11.1
 * supplies packs. **It records provenance and enforces nothing** — statutory validation is
 * `NOT VERIFIED` and deferred (D-5.2-06).
 */
export interface ViolationCategoryView {
  readonly violationCategoryId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly severity: string;
  readonly sequence: number;
  /**
   * How far back a prior violation counts, in days.
   *
   * **Operational since Checkpoint 3.** It was configuration nothing read for two checkpoints;
   * `relations.escalation-context` now measures its window with it. It still prescribes no outcome —
   * what a repeat *produces* is D-5.2-20 and is open.
   */
  readonly repeatWindowDays: number;
  readonly source: string;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active: boolean;
  readonly version: number;
}

/**
 * One recorded violation.
 *
 * `categoryCode` and `severity` are **what the catalogue said when the violation was recorded**, not
 * what it says now — so a screen shows what the record meant at the time even after the entry was
 * renamed or re-graded. `violationCategoryId` still points at the entry, so both questions can be
 * asked.
 *
 * There is no `state` transition here and no evidence: Checkpoint 1 records that a violation
 * occurred, and everything the lifecycle does with it afterwards is a later capability.
 */
export interface ViolationView {
  readonly violationId: string;
  readonly employmentId: string;
  readonly violationCategoryId: string;
  readonly categoryCode: string;
  readonly severity: string;
  /** The civil date the conduct occurred, `YYYY-MM-DD`. */
  readonly occurredOn: string;
  readonly description: string;
  readonly state: string;
  /** When it was recorded, as an ISO instant. Distinct from when the conduct occurred. */
  readonly recordedOn: string;
  /**
   * Where this violation sits in its own repeat window — 1 for a first occurrence, 3 for a third.
   *
   * **Derived at read time and stored nowhere** (Checkpoint 3). Measured back from *this violation's*
   * conduct date rather than from today, so the ordinal a record had when it happened is the ordinal
   * it still has a year later; counting back from today would renumber history every night.
   *
   * Absent when the category that would define the window could not be read. It is a projection, not
   * a fact about the row, and nothing may act on it automatically — what a repeat *produces* is
   * D-5.2-20 and is still an open decision.
   */
  readonly occurrence?: number;
  readonly version: number;
}

/** One bounded page of violations for a single employment. */
export interface ViolationPageView {
  readonly items: readonly ViolationView[];
  readonly total: number;
}

/**
 * One inquiry into a violation.
 *
 * `investigatorMembershipId` is a **tenant membership identifier and not a person**. A screen that
 * wants the investigator's name asks People for it, with People's own permissions applied — which is
 * the point: whether the reader may know who investigated is People's question, not this module's.
 *
 * `findings` and `recommendation` are absent while the inquiry is open. That is not a redaction — an
 * open investigation has concluded nothing, so there is nothing to publish.
 *
 * **The recommendation is text.** Nothing in this product acts on it. It does not instruct Payroll,
 * does not start a workflow and does not issue anything; a disciplinary outcome is a decision a named
 * human takes (ADR-0045), and a recommendation that took it automatically would be this module
 * deciding it instead.
 */
export interface InvestigationView {
  readonly investigationId: string;
  readonly violationId: string;
  readonly investigatorMembershipId: string;
  /** The civil date the inquiry opened, `YYYY-MM-DD`. */
  readonly openedOn: string;
  readonly subject: string;
  readonly state: string;
  readonly findings?: string;
  readonly recommendation?: string;
  readonly concludedOn?: string;
  /**
   * The concluded inquiry this one corrects, where it corrects one (D-5.2-19).
   *
   * Present on the correction and never on the corrected — the link points backward, so the record
   * being corrected is never written to. Follow the chain to see what was originally found; both
   * accounts survive, which is the point of correcting by adding rather than by editing.
   */
  readonly correctsInvestigationId?: string;
  readonly version: number;
}

export interface InvestigationPageView {
  readonly items: readonly InvestigationView[];
  readonly total: number;
}

/**
 * One movement of a case, as it will be read back in a dispute.
 *
 * `actor` is the authenticated caller who caused it and `occurredAt` came from the server's clock;
 * neither was ever a field a request could set. `reason` is required, so no transition in this
 * history is unexplained.
 */
export interface CaseEventView {
  readonly caseEventId: string;
  readonly sequence: number;
  readonly fromState: string;
  readonly toState: string;
  readonly reason: string;
  readonly actor: string;
  /** When the transition happened, as an ISO instant. */
  readonly occurredAt: string;
  readonly investigationId?: string;
}

/**
 * A case: where it is now, and every step that got it there.
 *
 * **`currentState` is derived from `history` and stored nowhere** (D-5.2-16). It is the `toState` of
 * the highest-numbered event, and a case with no events is `reported`. It appears in this view
 * because a screen should not have to re-derive it; it appears in no table, because a second copy is
 * a second thing that can disagree.
 */
export interface CaseHistoryView {
  readonly violationId: string;
  readonly currentState: string;
  readonly history: readonly CaseEventView[];
}

/**
 * How many times before, and over what window.
 *
 * **Every field is derived at read time.** Nothing here is persisted — there is no occurrence
 * counter, no repeat flag and no escalation level in any table, and a negative-space suite fails if
 * one appears. The count is arithmetic over violations that already exist.
 *
 * **`windowDays` and `windowFrom` are published deliberately.** A bare number invites the reader to
 * assume a window; showing which one was applied, and from which date, makes the answer checkable by
 * the person whose record it describes.
 *
 * **It carries no conclusion.** There is no `isRepeat`, no `escalationLevel`, no `breached` and no
 * recommended action: what a repeat should produce is D-5.2-20, still open, and a field asserting it
 * would be this module deciding a disciplinary outcome.
 */
export interface EscalationContextView {
  readonly employmentId: string;
  readonly violationCategoryId: string;
  /** The reference civil date the window was measured back from. */
  readonly asAt: string;
  readonly windowDays: number;
  /** The first civil date inside the window. Inclusive. */
  readonly windowFrom: string;
  readonly occurrences: number;
  /** The contributing violations, oldest first. Identifiers only — nothing about the person. */
  readonly violationIds: readonly string[];
}
