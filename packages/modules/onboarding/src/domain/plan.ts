import { uuidV7 } from '@work/kernel';

import {
  OnboardingAggregate,
  bilingualFrom,
  checkedCode,
  checkedMetadata,
  optionalBilingualFrom,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './onboarding-aggregate.js';
import { accept, refuse, type OnboardingResult } from './onboarding-rejection.js';
import type { PlanStatus } from './onboarding-vocabulary.js';

/**
 * An onboarding plan: the identity of a reusable definition — "corporate joiner", "field engineer",
 * "contractor".
 *
 * **The plan holds no tasks.** What it asks for lives in its versions, and that split is the whole
 * point: an administrator editing next quarter's checklist must not change what is being asked of
 * somebody who started last week (ADR-0048). The plan is what a customer names and retires; the
 * version is what an onboarding was generated from.
 *
 * **Nothing is shipped.** This product seeds no plan, no task and no code. A tenant that has
 * configured none gets an onboarding with no tasks and a screen that says so, which is honest —
 * shipping a default checklist would be this product deciding how a customer inducts people, and in
 * several markets part of that answer is statutory and belongs to a country pack (00B).
 */

export interface PlanState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly description?: BilingualText;
  readonly status: PlanStatus;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface CreatePlan {
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly description?: BilingualInput;
  readonly metadata?: Metadata;
}

export class Plan extends OnboardingAggregate {
  private constructor(private state: PlanState) {
    super(state.id, state.tenantId, state.version, 'OnboardingPlan');
  }

  public static create(request: CreatePlan, occurredAt: Date): OnboardingResult<Plan> {
    const code = checkedCode(request.code, 'code');

    if (!code.ok) return code;

    const name = bilingualFrom(request.name, 'name');

    if (!name.ok) return name;

    const description = optionalBilingualFrom(request.description, 'description');

    if (!description.ok) return description;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    return accept(
      new Plan({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        code: code.value,
        name: name.value,
        ...(description.value === undefined ? {} : { description: description.value }),
        // A plan starts as a draft even though its *first version* is what makes it usable: a plan
        // with no published version cannot be applied, and saying so in the status is clearer than
        // making every caller work it out from the version list.
        status: 'draft',
        metadata: metadata.value,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: PlanState): Plan {
    return new Plan(state);
  }

  public get status(): PlanStatus {
    return this.state.status;
  }

  public get code(): string {
    return this.state.code;
  }

  public amend(
    request: {
      readonly name?: BilingualInput;
      readonly description?: BilingualInput;
      readonly metadata?: Metadata;
    },
    occurredAt: Date,
  ): OnboardingResult<PlanState> {
    if (this.state.status === 'retired') return refuse('plan_retired');

    const changes = checkedAmendment(request);

    if (!changes.ok) return changes;

    this.state = { ...this.state, ...changes.value };
    this.touch(occurredAt);
    return accept(this.state);
  }

  /**
   * Marks the plan usable, which only a published version makes true.
   *
   * The caller passes whether one exists rather than the aggregate reaching for it: a plan does not
   * hold its versions, and an aggregate that loaded them to answer one question would be an
   * aggregate whose boundary is the whole configuration.
   */
  public activate(hasPublishedVersion: boolean, occurredAt: Date): OnboardingResult<PlanStatus> {
    if (this.state.status === 'retired') return refuse('plan_retired');
    if (!hasPublishedVersion) return refuse('plan_has_no_published_version');

    this.state = { ...this.state, status: 'active' };
    this.touch(occurredAt);
    return accept(this.state.status);
  }

  /**
   * Retires the plan. Onboardings already generated from it are untouched.
   *
   * Retiring is not deleting, and it is not cascading: an instance carries a copy of its tasks and
   * the identifier of the version it came from, so a retired plan stays readable for every
   * onboarding that used it — which is what makes "what were we asking of joiners last March"
   * answerable a year later.
   */
  public retire(occurredAt: Date): OnboardingResult<PlanStatus> {
    if (this.state.status === 'retired') return refuse('plan_already_retired');

    this.state = { ...this.state, status: 'retired' };
    this.touch(occurredAt);
    return accept(this.state.status);
  }

  public snapshot(): PlanState {
    return { ...this.state, version: this.version };
  }

  /** A plan raises no event of its own; its versions do. This keeps the aggregate's version moving. */
  private touch(_occurredAt: Date): void {
    this.state = { ...this.state };
  }
}

const checkedAmendment = (request: {
  readonly name?: BilingualInput;
  readonly description?: BilingualInput;
  readonly metadata?: Metadata;
}): OnboardingResult<Partial<PlanState>> => {
  const changes: Record<string, unknown> = {};

  if (request.name !== undefined) {
    const name = bilingualFrom(request.name, 'name');

    if (!name.ok) return name;
    changes['name'] = name.value;
  }
  if (request.description !== undefined) {
    const description = optionalBilingualFrom(request.description, 'description');

    if (!description.ok) return description;
    changes['description'] = description.value;
  }
  if (request.metadata !== undefined) {
    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;
    changes['metadata'] = metadata.value;
  }
  return accept(changes);
};
