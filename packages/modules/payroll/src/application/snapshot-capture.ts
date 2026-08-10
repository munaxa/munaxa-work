import { evaluateRule, type RuleDefinition } from '@work/kernel';

import type { PayrollGroupState } from '../domain/payroll-group.js';
import type { EmploymentSnapshot } from '../domain/payroll-snapshot.js';
import type { PayrollDependencies } from './payroll-dependencies.js';
import type { PeriodWindow, SourceAnswer } from './cross-module-ports.js';

/**
 * Capturing a batch of snapshots: **four source reads, one per contract, for a page of
 * employments**.
 *
 * Batched rather than per-employment, and that is the difference between a run that finishes at a
 * hundred thousand employments and one that makes four hundred thousand round trips (D-14). Each
 * source is asked once per batch and the answers are joined in memory.
 *
 * The sources are read **as at the period**, never as they are now. A period that closed in March
 * is snapshotted against March's employment status and March's cost centre, so re-running it after
 * an April transfer produces March's figures (ADR-0064).
 *
 * A source that cannot be asked is **absent from the snapshot**, not defaulted to nothing. The
 * distinction is what lets `snapshotBlockers` refuse to pay against facts nobody could confirm, and
 * it is ADR-0056's rule applied to four sources: unknown is not none.
 */

export interface CaptureRequest {
  readonly group: PayrollGroupState;
  readonly period: PeriodWindow;
  readonly employmentIds: readonly string[];
  readonly capturedAt: Date;
}

export const captureSnapshots = async (
  dependencies: PayrollDependencies,
  request: CaptureRequest,
): Promise<readonly EmploymentSnapshot[]> => {
  const [employment, compensation, attendance, leave] = await Promise.all([
    dependencies.employment.factsFor(request.employmentIds, request.period.periodEnd),
    dependencies.compensation.factsFor(request.employmentIds, request.period),
    dependencies.attendance.factsFor(request.employmentIds, request.period),
    dependencies.leave.factsFor(request.employmentIds, request.period),
  ]);

  return request.employmentIds.map((employmentId) => ({
    employmentId,
    ...present('employment', found(employment, employmentId)),
    ...present('compensation', found(compensation, employmentId)),
    ...present('attendance', found(attendance, employmentId)),
    ...present('leave', found(leave, employmentId)),
    capturedAt: request.capturedAt,
  }));
};

/**
 * One source's answer for one employment, or nothing.
 *
 * `known: false` and "answered with nothing" both produce nothing here, because the snapshot
 * records what was **consumed** and neither case consumed anything. The difference between them is
 * preserved where it changes behaviour: a source that could not be asked leaves its digest absent,
 * so a snapshot taken during an outage digests differently from one taken when the source answered
 * emptily, and reconciliation can tell them apart.
 */
const found = <TFacts>(answer: SourceAnswer<TFacts>, employmentId: string): TFacts | undefined =>
  answer.known ? answer.facts.get(employmentId) : undefined;

/** An absent key rather than an explicit `undefined`, which `exactOptionalPropertyTypes` separates. */
const present = <TKey extends string, TFacts>(
  key: TKey,
  facts: TFacts | undefined,
): Partial<Record<TKey, TFacts>> =>
  facts === undefined ? {} : ({ [key]: facts } as Record<TKey, TFacts>);

/**
 * Whether an employment belongs in this run, by the group's rule.
 *
 * The rule is **data** (`evaluateRule`), evaluated against facts Employment already publishes:
 * status as at the period end, employment type code, and whether the employment had ended before
 * the period began. Employment publishes no payroll-eligibility flag and is **not modified to add
 * one** (D-18) — the rule lives here, is versioned, and is written into the snapshot so a
 * historical population is reproducible.
 *
 * A group with no rule includes everybody the legal entity returned, minus the two structural
 * exclusions below. That is the ordinary configuration and it needs no rule to express.
 */
export interface EligibilityFacts {
  readonly status: string;
  readonly employmentTypeCode: string;
  readonly startedBeforePeriodEnd: boolean;
  readonly endedBeforePeriodStart: boolean;
}

export type Eligibility = 'included' | 'excluded' | 'rule_failed';

export const eligibilityOf = (group: PayrollGroupState, facts: EligibilityFacts): Eligibility => {
  // Structural, and not expressible as configuration: somebody who left before the period began
  // and somebody who had not started by the time it ended were simply not employed for it.
  if (facts.endedBeforePeriodStart || !facts.startedBeforePeriodEnd) return 'excluded';

  // No default: whether a suspended employment is paid is a contract question (§54).
  if (facts.status === 'suspended' && !group.paysSuspended) return 'excluded';
  if (facts.status === 'draft' || facts.status === 'pending_approval') return 'excluded';
  if (group.eligibilityRule === undefined) return 'included';

  return verdict(group.eligibilityRule, facts);
};

/**
 * A rule that cannot be evaluated is **`rule_failed`, not `excluded`**.
 *
 * The distinction is the difference between a person the configuration deliberately leaves out and
 * a person the configuration is broken about. Both are unpaid, and only one of them should be. The
 * caller records an exception for the second, so a misconfigured rule shows up as a number somebody
 * has to resolve before the run can be finalized — rather than as a quietly smaller payroll.
 */
const verdict = (rule: RuleDefinition, facts: EligibilityFacts): Eligibility => {
  const evaluation = evaluateRule(rule, {
    status: facts.status,
    employmentTypeCode: facts.employmentTypeCode,
  });

  if (!evaluation.ok) return 'rule_failed';
  return evaluation.value.matched ? 'included' : 'excluded';
};
