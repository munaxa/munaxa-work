import {
  addStep,
  createDefinition,
  draftVersion,
  publishVersion,
  type WorkflowStepTemplateState,
  type WorkflowVersionState,
} from './definition.js';
import { startInstance, type StartedInstance } from './instance.js';
import type { WorkflowResult } from './workflow-rejection.js';

/**
 * The scaffolding the domain suites share: a published version of a stated length, and an instance
 * started from it.
 *
 * It builds through the **real constructors** rather than by assembling state literals. A fixture
 * that hand-wrote a `WorkflowVersionState` would happily produce a published version with gapped
 * ordinals — the exact shape `publishVersion` exists to refuse — and every test resting on it would
 * be proving something about a state the product cannot reach.
 */

const NAME = { en: 'Step', ar: 'خطوة' };

/** Unwraps a result the fixture requires to have succeeded, and says which one did not. */
export const must = <TValue>(result: WorkflowResult<TValue>, what: string): TValue => {
  if (!result.ok) throw new Error(`The fixture could not build ${what}: ${result.error.reason}.`);
  return result.value;
};

export const APPROVERS = ['membership-one', 'membership-two', 'membership-three'] as const;

export const AT = new Date('2026-08-14T09:00:00.000Z');

export interface PublishedVersion {
  readonly version: WorkflowVersionState;
  readonly templates: readonly WorkflowStepTemplateState[];
}

/**
 * A published version with `steps` steps, each assigned to a different membership.
 *
 * Different memberships rather than one repeated, because a suite that used the same approver for
 * every step could not tell "the assigned approver decided" from "somebody who was assigned *a*
 * step decided", and those are different authorization outcomes.
 */
export const publishedVersion = (steps: number): PublishedVersion => {
  const definition = must(
    createDefinition({
      definitionId: 'definition-1',
      code: 'requisition-approval',
      name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
      subjectType: 'recruitment.requisition',
    }),
    'a definition',
  );
  const draft = must(
    draftVersion(definition, { workflowVersionId: 'version-1', versionNumber: 1 }),
    'a draft version',
  );
  const templates = Array.from({ length: steps }, (_, index) =>
    must(
      addStep(draft, {
        stepTemplateId: `template-${String(index + 1)}`,
        ordinal: index + 1,
        name: NAME,
        approverKind: 'membership',
        approverMembershipId: APPROVERS[index % APPROVERS.length] ?? 'membership-one',
      }),
      `step ${String(index + 1)}`,
    ),
  );

  return {
    version: must(publishVersion(draft, templates, AT, 'user:admin'), 'a published version'),
    templates,
  };
};

/** An instance started from a freshly published version of `steps` steps. */
export const startedInstance = (steps: number): StartedInstance & PublishedVersion => {
  const published = publishedVersion(steps);
  const started = must(
    startInstance(published.version, published.templates, {
      instanceId: 'instance-1',
      subjectType: 'recruitment.requisition',
      subjectId: 'requisition-1',
      requestedByMembershipId: 'membership-requester',
      correlationId: 'correlation-1',
      context: { headcount: 2 },
      at: AT,
      stepIds: Array.from({ length: steps }, (_, index) => `step-${String(index + 1)}`),
    }),
    'a started instance',
  );

  return { ...published, ...started };
};
