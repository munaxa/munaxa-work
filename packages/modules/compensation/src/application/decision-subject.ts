import type { Transaction } from '@work/kernel';

import { accept, refuse, type CompensationResult } from '../domain/compensation-rejection.js';
import type { ApprovalState, SubjectKind } from '../domain/compensation-vocabulary.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * Reading the subject a decision is about, and writing the resulting state back onto it.
 *
 * Three subject kinds — a recurring period, a one-time item, an adjustment — and each answers the
 * same three questions in a different table. Apart from the handlers because the handlers are
 * transport and this is the resolution, and because three `if` branches over three stores is
 * exactly the shape a file budget exists to keep out of a command.
 */

export interface DecisionSubject {
  readonly requestedBy: string;
  readonly employmentId: string;
  readonly effectiveFrom?: string;
  readonly approvalsRequired: number;
}

/**
 * The three things a decision needs from its subject: who asked, whose compensation it is, and when
 * it takes effect.
 *
 * `requestedBy` is **copied onto the decision row**, which is what makes the self-approval check
 * constraint enforceable — a check constraint cannot reach another table.
 */
export const subjectOf = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  subjectKind: string,
  subjectId: string,
): Promise<CompensationResult<DecisionSubject>> => {
  if (subjectKind === 'recurring') {
    const record = await dependencies.stores.recurring.byId(transaction, subjectId);

    if (record === undefined) return refuse('subject_not_found', { subjectKind });
    return withPlan(dependencies, transaction, record.compensationPlanId, {
      requestedBy: record.recordedBy,
      employmentId: record.employmentId,
      effectiveFrom: record.effectiveFrom,
    });
  }
  if (subjectKind === 'one_time') {
    const record = await dependencies.stores.oneTime.byId(transaction, subjectId);

    if (record === undefined) return refuse('subject_not_found', { subjectKind });
    return withPlan(dependencies, transaction, record.compensationPlanId, {
      requestedBy: record.recordedBy,
      employmentId: record.employmentId,
      effectiveFrom: record.payableOn,
    });
  }
  if (subjectKind === 'adjustment') {
    const record = await dependencies.stores.adjustments.byId(transaction, subjectId);

    if (record === undefined) return refuse('subject_not_found', { subjectKind });
    // An adjustment names no plan of its own; it follows the recurring period it explains, and a
    // single approval is required where one is required at all.
    return accept({
      requestedBy: record.requestedBy,
      employmentId: record.employmentId,
      effectiveFrom: record.effectiveFrom,
      approvalsRequired: record.approvalState === 'not_required' ? 0 : 1,
    });
  }
  return refuse('subject_kind_unknown', { subjectKind });
};

const withPlan = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  planId: string,
  subject: Omit<DecisionSubject, 'approvalsRequired'>,
): Promise<CompensationResult<DecisionSubject>> => {
  const plan = await dependencies.stores.plans.byId(transaction, planId);

  return accept({ ...subject, approvalsRequired: plan?.approvalsRequired ?? 1 });
};

/** Writes the resulting approval state back onto the subject, and the approval instant with it. */
export const applyState = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  subjectKind: SubjectKind,
  subjectId: string,
  state: ApprovalState,
): Promise<void> => {
  const at = dependencies.clock.now();
  const approved = state === 'approved' ? { approvedAt: at } : {};

  if (subjectKind === 'recurring') {
    const record = await dependencies.stores.recurring.byId(transaction, subjectId);

    if (record === undefined) return;
    await dependencies.stores.recurring.update(
      transaction,
      { ...record, approvalState: state, ...approved },
      record.version,
    );
    return;
  }
  if (subjectKind === 'one_time') {
    const record = await dependencies.stores.oneTime.byId(transaction, subjectId);

    if (record === undefined) return;
    await dependencies.stores.oneTime.update(
      transaction,
      { ...record, approvalState: state, ...approved },
      record.version,
    );
    return;
  }
  const record = await dependencies.stores.adjustments.byId(transaction, subjectId);

  if (record === undefined) return;
  await dependencies.stores.adjustments.update(
    transaction,
    { ...record, approvalState: state },
    record.version,
  );
};
