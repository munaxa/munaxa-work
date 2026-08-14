import { uuidV7 } from '@work/kernel';

import {
  addStep,
  createDefinition,
  draftVersion,
  publishVersion,
  type WorkflowDefinitionState,
  type WorkflowStepTemplateState,
  type WorkflowVersionState,
} from '../domain/definition.js';
import { startInstance, type StartedInstance, type WorkflowStepState } from '../domain/instance.js';
import { decide, type DecidedStep } from '../domain/decision.js';
import { startHistory } from '../domain/history.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import type { WorkflowResult } from '../domain/workflow-rejection.js';
import { APPROVER, DEPUTY, REQUESTER, SUBJECT_TYPE } from './workflow-database.fixture.js';

/**
 * Domain states for the repository suites, built **through the domain's own constructors**.
 *
 * Not object literals. A literal could describe a state the domain refuses — a published version with
 * gapped ordinals, a delegated decision naming somebody who is not the step's approver, an instance
 * with two steps awaiting — and a persistence test resting on one would be asserting that the
 * database stores something the application can never produce. Career's `career-states.ts` is the
 * same construction for the same reason.
 *
 * **The identifiers are real UUIDs**, because every primary key in this module is a `uuid` column.
 * The seed helpers beside this file let the database mint them, which is what the application does;
 * these mint them in TypeScript, because a repository `insert` takes a state that already has one.
 *
 * These are *states*, not commands. The application suites already tested the decisions; what is
 * under test here is whether a state survives real columns, real types and real indexes intact.
 */

export const NOW = new Date('2026-08-14T09:00:00.000Z');

/** A second instant, distinct from `NOW` to the millisecond, for ordering assertions. */
export const LATER = new Date('2026-08-14T09:05:00.500Z');

export const ADMIN = 'user:workflow-admin';

const NAME = { en: 'Approval', ar: 'اعتماد' };

/** Unwraps a domain result, failing loudly rather than persisting `undefined`. */
export const accepted = <TState>(result: WorkflowResult<TState>): TState => {
  if (!result.ok) throw new Error(`The domain refused a fixture state: ${result.error.reason}`);
  return result.value;
};

let sequence = 0;

/** A code that is unique per call, so a fixture never accidentally tests the uniqueness index. */
export const aCode = (prefix = 'approval'): string => {
  sequence += 1;
  return `${prefix}-${String(sequence)}`;
};

export const aDefinition = (
  overrides: { code?: string; subjectType?: string; description?: string } = {},
): WorkflowDefinitionState =>
  accepted(
    createDefinition({
      definitionId: uuidV7(),
      code: overrides.code ?? aCode(),
      name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
      subjectType: overrides.subjectType ?? SUBJECT_TYPE,
      ...(overrides.description === undefined ? {} : { description: overrides.description }),
    }),
  );

export const aDraft = (
  definition: WorkflowDefinitionState,
  versionNumber = 1,
): WorkflowVersionState =>
  accepted(draftVersion(definition, { workflowVersionId: uuidV7(), versionNumber }));

export const aTemplate = (
  draft: WorkflowVersionState,
  ordinal: number,
  approverMembershipId: string = APPROVER,
): WorkflowStepTemplateState =>
  accepted(
    addStep(draft, {
      stepTemplateId: uuidV7(),
      ordinal,
      name: NAME,
      approverKind: 'membership',
      approverMembershipId,
    }),
  );

export interface PublishedDefinition {
  readonly definition: WorkflowDefinitionState;
  readonly version: WorkflowVersionState;
  readonly templates: readonly WorkflowStepTemplateState[];
}

/**
 * Another published version of a definition that already exists.
 *
 * Built through `publishVersion` rather than by spreading `status: 'published'` over a draft, because
 * the schema's `workflow_version_published_check` requires `published_at` alongside the status — and
 * a fixture that set one without the other would be describing a row the database refuses.
 */
export const aPublishedVersionOf = (
  definition: WorkflowDefinitionState,
  versionNumber: number,
  approvers: readonly string[] = [APPROVER],
): Omit<PublishedDefinition, 'definition'> => {
  const draft = aDraft(definition, versionNumber);
  const templates = approvers.map((approver, index) => aTemplate(draft, index + 1, approver));

  return { version: accepted(publishVersion(draft, templates, NOW, ADMIN)), templates };
};

/** A definition with one published version, one step per approver named, in the order given. */
export const aPublishedDefinition = (
  approvers: readonly string[] = [APPROVER],
  overrides: { code?: string; versionNumber?: number } = {},
): PublishedDefinition => {
  const definition = aDefinition(overrides.code === undefined ? {} : { code: overrides.code });

  return {
    definition,
    ...aPublishedVersionOf(definition, overrides.versionNumber ?? 1, approvers),
  };
};

export interface StartedFromDefinition extends PublishedDefinition, StartedInstance {
  readonly history: readonly WorkflowHistoryState[];
}

/** An instance started from a freshly published version, with the two entries a start writes. */
export const aStartedInstance = (
  approvers: readonly string[] = [APPROVER],
  overrides: { subjectId?: string; at?: Date; code?: string } = {},
): StartedFromDefinition => {
  const published = aPublishedDefinition(
    approvers,
    overrides.code === undefined ? {} : { code: overrides.code },
  );
  const started = accepted(
    startInstance(published.version, published.templates, {
      instanceId: uuidV7(),
      subjectType: SUBJECT_TYPE,
      subjectId: overrides.subjectId ?? 'requisition-1',
      requestedByMembershipId: REQUESTER,
      correlationId: uuidV7(),
      context: { headcount: 2 },
      at: overrides.at ?? NOW,
      stepIds: published.templates.map(() => uuidV7()),
    }),
  );

  return { ...published, ...started, history: startHistory(started, [uuidV7(), uuidV7()]) };
};

/**
 * One step of a started instance, by position, failing loudly when it is not there.
 *
 * Indexing an array gives `T | undefined` under `noUncheckedIndexedAccess`, and spreading that into a
 * new state quietly turns every required field optional. A suite that did so would be persisting a
 * shape the domain cannot produce, which is the whole thing these fixtures exist to prevent.
 */
export const stepAt = (started: StartedInstance, index: number): WorkflowStepState => {
  const step = [...started.steps].sort((left, right) => left.ordinal - right.ordinal)[index];

  if (step === undefined) throw new Error(`The fixture has no step at position ${String(index)}.`);
  return step;
};

/** The step of a started instance a decision is being asked for. */
export const awaiting = (started: StartedInstance): WorkflowStepState => stepAt(started, 0);

/** The assigned approver's own decision on the awaiting step. */
export const anApproval = (
  started: StartedInstance,
  overrides: { at?: Date; comment?: string } = {},
): DecidedStep => {
  const step = awaiting(started);

  return accepted(
    decide(started.instance, step, started.steps, {
      decisionId: uuidV7(),
      decision: 'approved',
      decidedByMembershipId: step.approverMembershipId,
      authority: 'assigned',
      at: overrides.at ?? LATER,
      ...(overrides.comment === undefined ? {} : { comment: overrides.comment }),
    }),
  );
};

/**
 * A decision the deputy made on the approver's behalf.
 *
 * Two memberships, both recorded: `decidedByMembershipId` is the deputy who acted, and
 * `onBehalfOfMembershipId` is the approver whose authority was used. The round trip of *both* columns
 * is what the persistence suite checks, because collapsing them is the dishonesty this seam exists to
 * prevent.
 */
export const aDelegatedApproval = (started: StartedInstance): DecidedStep => {
  const step = awaiting(started);

  return accepted(
    decide(started.instance, step, started.steps, {
      decisionId: uuidV7(),
      decision: 'approved',
      decidedByMembershipId: DEPUTY,
      authority: 'delegated',
      onBehalfOfMembershipId: step.approverMembershipId,
      at: LATER,
    }),
  );
};
