import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  OnboardingAggregate,
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedOptionalCivilDate,
  type Metadata,
} from './onboarding-aggregate.js';
import { OnboardingEvents } from './onboarding-events.js';
import { accept, refuse, type OnboardingResult } from './onboarding-rejection.js';
import {
  ONBOARDING_TRANSITIONS,
  isOnboardingTerminal,
  type OnboardingState,
} from './onboarding-vocabulary.js';
import type { OnboardingInstanceState } from './onboarding-state.js';

export type { OnboardingInstanceState } from './onboarding-state.js';

/**
 * One onboarding process, for one employment.
 *
 * **It owns the process and nothing else.** The employment already exists — Recruitment's hire saga
 * created the Person and the Employment through their own application services (ADR-0046) — and this
 * aggregate references both. It creates neither, and it changes neither: completing an onboarding
 * does not activate an employment, and cancelling one does not end it (ADR-0047).
 *
 * **At most one live onboarding per employment**, enforced by a partial unique index. That is what
 * makes the start command idempotent: two concurrent starts race at the index, one wins, and the
 * loser reads the winner's instance rather than creating a second (ADR-0050).
 *
 * **Completion is explicit and never automatic.** It is refused while any *required* task is still
 * open, because a completion recorded over three outstanding mandatory tasks is a completion that
 * means nothing to the person who later relies on it.
 */

export interface StartOnboarding {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly personId: string;
  readonly applicationId?: string;
  readonly plannedStartOn: string;
  readonly employmentStartOn?: string;
  readonly metadata?: Metadata;
}

/** What completion asks of the tasks. Counted by the caller, decided here. */
export interface RequiredTaskTally {
  readonly requiredTotal: number;
  readonly requiredSatisfied: number;
}

export class Onboarding extends OnboardingAggregate {
  private constructor(private instance: OnboardingInstanceState) {
    super(instance.id, instance.tenantId, instance.version, 'Onboarding');
  }

  public static start(
    request: StartOnboarding,
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<Onboarding> {
    const plannedStartOn = checkedCivilDate(request.plannedStartOn, 'plannedStartOn');

    if (!plannedStartOn.ok) return plannedStartOn;

    const employmentStartOn = checkedOptionalCivilDate(
      request.employmentStartOn,
      'employmentStartOn',
    );

    if (!employmentStartOn.ok) return employmentStartOn;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    const onboarding = new Onboarding({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      employmentId: request.employmentId,
      personId: request.personId,
      ...(request.applicationId === undefined ? {} : { applicationId: request.applicationId }),
      state: 'draft',
      plannedStartOn: plannedStartOn.value,
      ...(employmentStartOn.value === undefined
        ? {}
        : { employmentStartOn: employmentStartOn.value }),
      metadata: metadata.value,
      version: 0,
    });

    // Identifiers and dates. No name, no address, no task text: this event reaches consumers this
    // module does not know and ends up in their logs.
    onboarding.raise(
      OnboardingEvents.instanceCreated,
      {
        onboardingId: onboarding.id,
        employmentId: request.employmentId,
        personId: request.personId,
        plannedStartOn: plannedStartOn.value,
      },
      origin,
      occurredAt,
    );
    return accept(onboarding);
  }

  public static rehydrate(state: OnboardingInstanceState): Onboarding {
    return new Onboarding(state);
  }

  public get state(): OnboardingState {
    return this.instance.state;
  }

  public get employmentId(): string {
    return this.instance.employmentId;
  }

  public get plannedStartOn(): string {
    return this.instance.plannedStartOn;
  }

  public get employmentStartOn(): string | undefined {
    return this.instance.employmentStartOn;
  }

  public get planVersionId(): string | undefined {
    return this.instance.planVersionId;
  }

  /**
   * Records which plan version this onboarding was generated from.
   *
   * Written once, at generation. Repointing it would make the instance claim it came from a
   * checklist it was never measured against, which is the one thing plan versioning exists to
   * prevent (ADR-0048).
   */
  public recordPlan(planId: string, planVersionId: string): OnboardingResult<string> {
    if (this.instance.planVersionId !== undefined) return refuse('onboarding_already_planned');
    if (isOnboardingTerminal(this.instance.state)) return refuse('onboarding_concluded');

    this.instance = { ...this.instance, planId, planVersionId };
    return accept(planVersionId);
  }

  /** Preboarding: work before the first day. It says nothing about the employment's status. */
  public beginPreboarding(origin: EventOrigin, occurredAt: Date): OnboardingResult<OnboardingState> {
    return this.moveTo('preboarding', origin, occurredAt);
  }

  public beginOnboarding(origin: EventOrigin, occurredAt: Date): OnboardingResult<OnboardingState> {
    return this.moveTo('in_progress', origin, occurredAt);
  }

  /**
   * Completes the onboarding.
   *
   * Refused while a required task is unsatisfied. `done` and `waived` both satisfy — a waiver is a
   * decision somebody made and recorded a reason for — and `cancelled` does not, because a task
   * cancelled with the onboarding still running was never dealt with.
   *
   * **This changes no employment fact.** A tenant that wants activation on completion adds a task
   * that activates it, and that act is audited as its own (ADR-0047).
   */
  public complete(
    tally: RequiredTaskTally,
    completedBy: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<OnboardingState> {
    if (tally.requiredSatisfied < tally.requiredTotal) {
      return refuse('required_tasks_outstanding', {
        outstanding: String(tally.requiredTotal - tally.requiredSatisfied),
      });
    }

    const moved = this.moveTo('completed', origin, occurredAt);

    if (!moved.ok) return moved;

    this.instance = {
      ...this.instance,
      completedOn: occurredAt.toISOString().slice(0, 10),
      completedAt: occurredAt,
      completedBy,
    };
    this.raise(
      OnboardingEvents.instanceCompleted,
      {
        onboardingId: this.id,
        employmentId: this.instance.employmentId,
        completedOn: this.instance.completedOn,
      },
      origin,
      occurredAt,
    );
    return accept(this.instance.state);
  }

  /**
   * Cancels the onboarding, with a reason.
   *
   * **It does not end the employment.** A withdrawn hire, a no-show or a resignation before the
   * first day are all employment facts, and ending an employment is Employment's operation and
   * eventually Offboarding's process. What this records is that the onboarding will not finish.
   */
  public cancel(
    reasonCode: string,
    cancelledBy: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<OnboardingState> {
    const code = checkedCode(reasonCode, 'cancellationReasonCode');

    if (!code.ok) return code;

    const moved = this.moveTo('cancelled', origin, occurredAt);

    if (!moved.ok) return moved;

    this.instance = {
      ...this.instance,
      cancelledAt: occurredAt,
      cancelledBy,
      cancellationReasonCode: code.value,
    };
    this.raise(
      OnboardingEvents.instanceCancelled,
      {
        onboardingId: this.id,
        employmentId: this.instance.employmentId,
        reasonCode: code.value,
      },
      origin,
      occurredAt,
    );
    return accept(this.instance.state);
  }

  public snapshot(): OnboardingInstanceState {
    return { ...this.instance, version: this.version };
  }

  private moveTo(
    next: OnboardingState,
    origin: EventOrigin,
    occurredAt: Date,
  ): OnboardingResult<OnboardingState> {
    const from = this.instance.state;

    if (from === next) return refuse('onboarding_already_in_state', { state: next });
    if (!ONBOARDING_TRANSITIONS[from].includes(next)) {
      return refuse('onboarding_transition_not_permitted', { from, to: next });
    }

    this.instance = { ...this.instance, state: next };
    this.raise(
      OnboardingEvents.instanceStateChanged,
      { onboardingId: this.id, employmentId: this.instance.employmentId, from, to: next },
      origin,
      occurredAt,
    );
    return accept(next);
  }
}
