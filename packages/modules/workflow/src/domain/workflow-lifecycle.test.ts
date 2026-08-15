import { describe, expect, it } from 'vitest';

import {
  addStep,
  archiveVersion,
  createDefinition,
  draftVersion,
  ordinalsAreContiguous,
  publishVersion,
  retireDefinition,
} from './definition.js';
import { cancelInstance, startInstance } from './instance.js';
import { AT, must, publishedVersion, startedInstance } from './workflow-fixtures.js';
import {
  WORKFLOW_INSTANCE_TRANSITIONS,
  WORKFLOW_STEP_TRANSITIONS,
  WORKFLOW_VERSION_TRANSITIONS,
} from './workflow-vocabulary.js';

const NAME = { en: 'Step', ar: 'خطوة' };
const reasonOf = (result: { ok: boolean; error?: { reason: string } }): string | undefined =>
  result.ok ? undefined : result.error?.reason;

describe('a workflow definition', () => {
  it('refuses a code, a name or a subject type that is not one', () => {
    const request = {
      definitionId: 'd',
      code: 'Requisition Approval',
      name: { en: 'x', ar: 'x' },
      subjectType: 'recruitment.requisition',
    };

    expect(reasonOf(createDefinition(request))).toBe('definition-code-invalid');
    expect(reasonOf(createDefinition({ ...request, code: 'ok', name: { en: ' ', ar: 'x' } }))).toBe(
      'definition-name-required',
    );
    expect(reasonOf(createDefinition({ ...request, code: 'ok', subjectType: 'requisition' }))).toBe(
      'definition-subject-type-invalid',
    );
  });

  /**
   * A description is optional, and a description that is present is a description in both languages.
   *
   * The column has always been `jsonb`; Checkpoint 6 brought the domain to it, matching the `name`
   * beside it. "Optional" and "unchecked" are different things: `{ en: 'Hiring', ar: '' }` is not a
   * bilingual description, and letting it through would put a blank on the Arabic screen of a
   * definition that looks complete in English.
   */
  it('accepts a definition with no description at all', () => {
    const made = createDefinition({
      definitionId: 'd',
      code: 'ok',
      name: NAME,
      subjectType: 'a.b',
    });

    expect(made.ok).toBe(true);
    expect(made.ok && 'description' in made.value).toBe(false);
  });

  it('accepts a description written in both languages, and keeps both', () => {
    const description = { en: 'Raised for a requisition', ar: 'يُرفع لطلب توظيف' };
    const made = createDefinition({
      definitionId: 'd',
      code: 'ok',
      name: NAME,
      subjectType: 'a.b',
      description,
    });

    expect(made.ok && made.value.description).toEqual(description);
  });

  it('refuses a description missing a language, or blank in one', () => {
    const request = { definitionId: 'd', code: 'ok', name: NAME, subjectType: 'a.b' };

    expect(reasonOf(createDefinition({ ...request, description: { en: 'Hiring', ar: '' } }))).toBe(
      'definition-description-invalid',
    );
    expect(reasonOf(createDefinition({ ...request, description: { en: '  ', ar: 'توظيف' } }))).toBe(
      'definition-description-invalid',
    );
    expect(
      reasonOf(
        createDefinition({
          ...request,
          // A caller sending the pre-Checkpoint-6 shape: a plain string where a localized value
          // belongs. It reaches the domain as an object with neither language.
          description: 'Raised for a requisition' as unknown as { en: string; ar: string },
        }),
      ),
    ).toBe('definition-description-invalid');
  });

  it('accepts a dotted subject type without holding any list of them', () => {
    // The point of the assertion: a subject type from a module Workflow has never heard of is
    // accepted on shape alone. A list of legal values here would be a list of business modules.
    const made = createDefinition({
      definitionId: 'd',
      code: 'ok',
      name: NAME,
      subjectType: 'some-future-module.some-subject',
    });

    expect(made.ok).toBe(true);
  });

  it('retires terminally, and a retired definition takes no new version', () => {
    const definition = must(
      createDefinition({ definitionId: 'd', code: 'ok', name: NAME, subjectType: 'a.b' }),
      'a definition',
    );
    const retired = must(retireDefinition(definition, AT, 'user:admin'), 'a retirement');

    expect(retired.status).toBe('retired');
    expect(reasonOf(retireDefinition(retired, AT, 'user:admin'))).toBe(
      'definition-transition-refused',
    );
    expect(reasonOf(draftVersion(retired, { workflowVersionId: 'v', versionNumber: 2 }))).toBe(
      'definition-retired',
    );
  });
});

describe('a workflow version', () => {
  it('has no path back to draft once published (AD-003)', () => {
    expect(WORKFLOW_VERSION_TRANSITIONS.published).not.toContain('draft');
    expect(WORKFLOW_VERSION_TRANSITIONS.archived).toStrictEqual([]);
  });

  it('takes no step once published', () => {
    const { version } = publishedVersion(2);

    expect(
      reasonOf(
        addStep(version, {
          stepTemplateId: 't',
          ordinal: 3,
          name: NAME,
          approverKind: 'membership',
          approverMembershipId: 'm',
        }),
      ),
    ).toBe('version-not-editable');
  });

  it('refuses to publish with nothing to approve', () => {
    const definition = must(
      createDefinition({ definitionId: 'd', code: 'ok', name: NAME, subjectType: 'a.b' }),
      'a definition',
    );
    const draft = must(
      draftVersion(definition, { workflowVersionId: 'v', versionNumber: 1 }),
      'a draft',
    );

    expect(reasonOf(publishVersion(draft, [], AT, 'user:admin'))).toBe('version-has-no-steps');
  });

  /**
   * **The rule changed in Phase 16B, and this is the assertion that says how.**
   *
   * A gap is still refused: "advance to the next branch" has to be total, and a version jumping from
   * 1 to 3 leaves a hole nothing walks. A **repeat is no longer a gap** — three templates at ordinal
   * 1 are a branch of three, all asked at once, which is the whole of parallel approval. What has to
   * be contiguous is the set of *distinct* ordinals.
   *
   * The old assertion was not deleted; it was rewritten to the invariant that replaced it, because a
   * removed assertion is a removed guarantee.
   */
  it('refuses a gapped order, and treats a repeated ordinal as a branch', () => {
    const { templates, version } = publishedVersion(3);
    const gapped = [templates[0], templates[1]].flatMap((step) =>
      step === undefined ? [] : [{ ...step, ordinal: step.ordinal === 1 ? 1 : 3 }],
    );
    const branch = templates.map((step) => ({ ...step, ordinal: 1 }));

    expect(ordinalsAreContiguous(gapped)).toBe(false);
    expect(ordinalsAreContiguous(branch)).toBe(true);
    expect(ordinalsAreContiguous([...templates].reverse())).toBe(true);
    expect(version.status).toBe('published');
  });

  /** And a branch of three publishes, because its three steps agree about how it ends. */
  it('publishes a version whose only branch holds three approvers', () => {
    const { templates } = publishedVersion(3);
    const draft = must(
      draftVersion(
        must(
          createDefinition({
            definitionId: 'd',
            code: 'branching',
            name: { en: 'Branching', ar: 'تفرع' },
            subjectType: 'a.subject',
          }),
          'a definition',
        ),
        { workflowVersionId: 'v', versionNumber: 1 },
      ),
      'a draft',
    );
    const branch = templates.map((step) => ({ ...step, ordinal: 1 }));

    expect(publishVersion(draft, branch, AT, 'user:admin').ok).toBe(true);
  });

  it('declares no maximum number of steps (AD-004)', () => {
    // Not a performance claim — a claim about the absence of a hardcoded ceiling. Career caps a
    // stage sequence at 500 and a rank at 50; AD-004 forbids the equivalent here.
    const { templates } = publishedVersion(1);
    const first = templates[0];

    expect(first).toBeDefined();
    expect(
      addStep(
        must(
          draftVersion(
            must(
              createDefinition({ definitionId: 'd', code: 'ok', name: NAME, subjectType: 'a.b' }),
              'a definition',
            ),
            { workflowVersionId: 'v', versionNumber: 1 },
          ),
          'a draft',
        ),
        {
          stepTemplateId: 't',
          ordinal: 100_000,
          name: NAME,
          approverKind: 'membership',
          approverMembershipId: 'm',
        },
      ).ok,
    ).toBe(true);
  });

  it('archives, and an archived version starts nothing', () => {
    const { templates, version } = publishedVersion(1);
    const archived = must(archiveVersion(version), 'an archived version');

    expect(
      reasonOf(
        startInstance(archived, templates, {
          instanceId: 'i',
          subjectType: 'a.b',
          subjectId: 's',
          requestedByMembershipId: 'm',
          correlationId: 'c',
          context: {},
          at: AT,
          stepIds: ['step-1'],
        }),
      ),
    ).toBe('version-not-published');
  });
});

describe('starting an instance', () => {
  it('copies the version’s steps rather than pointing at them (AD-003)', () => {
    const started = startedInstance(3);
    const templateApprovers = [...started.templates]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((template) => template.approverMembershipId);

    expect(started.steps.map((step) => step.approverMembershipId)).toStrictEqual(templateApprovers);
    expect(started.steps.map((step) => step.stepId)).toStrictEqual(['step-1', 'step-2', 'step-3']);
    // The copy is what makes this true: nothing on a step references the template it came from.
    expect(Object.keys(started.steps[0] ?? {})).not.toContain('stepTemplateId');
  });

  it('leaves exactly one step awaiting a decision, and it is the first', () => {
    const started = startedInstance(4);
    const awaiting = started.steps.filter((step) => step.status === 'awaiting');

    expect(awaiting).toHaveLength(1);
    expect(awaiting[0]?.ordinal).toBe(1);
    expect(started.steps.filter((step) => step.status === 'pending')).toHaveLength(3);
  });

  it('stores the requesting module’s context without reading it', () => {
    const started = startedInstance(1);

    expect(started.instance.context).toStrictEqual({ headcount: 2 });
    expect(started.instance.status).toBe('running');
  });

  it('refuses a step identifier list that does not match the steps', () => {
    const { templates, version } = publishedVersion(2);
    const request = {
      instanceId: 'i',
      subjectType: 'a.b',
      subjectId: 's',
      requestedByMembershipId: 'm',
      correlationId: 'c',
      context: {},
      at: AT,
    };

    expect(reasonOf(startInstance(version, templates, { ...request, stepIds: ['one'] }))).toBe(
      'step-identifiers-mismatched',
    );
    expect(reasonOf(startInstance(version, templates, { ...request, stepIds: ['one', ' '] }))).toBe(
      'step-identifiers-mismatched',
    );
  });
});

describe('cancelling an instance', () => {
  it('is terminal, needs a reason, and skips every open step', () => {
    const started = startedInstance(3);
    const cancelled = must(
      cancelInstance(started.instance, started.steps, {
        by: 'user:admin',
        reason: 'The vacancy was withdrawn.',
        at: AT,
      }),
      'a cancellation',
    );

    expect(cancelled.instance.status).toBe('cancelled');
    expect(cancelled.skipped).toHaveLength(3);
    expect(cancelled.skipped.every((step) => step.status === 'skipped')).toBe(true);
    expect(WORKFLOW_INSTANCE_TRANSITIONS.cancelled).toStrictEqual([]);
  });

  it('refuses without a reason, and refuses a second time', () => {
    const started = startedInstance(1);

    expect(
      reasonOf(cancelInstance(started.instance, started.steps, { by: 'u', reason: '  ', at: AT })),
    ).toBe('cancellation-reason-required');

    const cancelled = must(
      cancelInstance(started.instance, started.steps, { by: 'u', reason: 'stopped', at: AT }),
      'a cancellation',
    );

    expect(
      reasonOf(cancelInstance(cancelled.instance, started.steps, { by: 'u', reason: 'x', at: AT })),
    ).toBe('instance-not-running');
  });

  it('is not a rejection', () => {
    // The business module must be able to tell "nobody decided" from "somebody refused".
    const started = startedInstance(1);
    const cancelled = must(
      cancelInstance(started.instance, started.steps, { by: 'u', reason: 'stopped', at: AT }),
      'a cancellation',
    );

    expect(cancelled.instance.status).not.toBe('rejected');
    expect(WORKFLOW_STEP_TRANSITIONS.skipped).toStrictEqual([]);
  });
});
