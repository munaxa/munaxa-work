import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  RecruitmentAggregate,
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
  checkedText,
} from './recruitment-aggregate.js';
import { beganHire, employmentCreated, personLinked, type HireStep } from './application-hire.js';
import { RecruitmentEvents } from './recruitment-events.js';
import type { ApplicationState, SubmitApplication } from './application-state.js';

export type { ApplicationState, SubmitApplication } from './application-state.js';
import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import {
  APPLICATION_TRANSITIONS,
  isApplicationClosed,
  type ApplicationStatus,
  type HireState,
  type ScreeningOutcome,
} from './recruitment-vocabulary.js';

/**
 * An Application: one candidate's pursuit of one vacancy.
 *
 * **The join is the process.** The pipeline status lives here rather than on the candidate, because
 * somebody rejected for one role is not a rejected candidate — they are an active candidate with a
 * rejected application, and conflating the two is how a product loses its own talent pool.
 *
 * **A candidate re-applying reopens this application** rather than creating a second. One row per
 * pair is enforced by unique index, and without it every pipeline count is wrong the first time
 * somebody tries again.
 *
 * **The hire is a saga on this aggregate** (ADR-0046). Its steps are in `application-hire.ts`.
 */

const NOTE_LIMIT = 1024;

const withoutRejectionReason = ({
  rejectionReasonCode: _cleared,
  ...rest
}: ApplicationState): ApplicationState => rest;

export class Application extends RecruitmentAggregate {
  private constructor(private state: ApplicationState) {
    super(state.id, state.tenantId, state.version, 'Application');
  }

  public static submit(
    request: SubmitApplication,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<Application> {
    const sourceCode = checkedCode(request.sourceCode, 'sourceCode');

    if (!sourceCode.ok) return sourceCode;

    const appliedOn = checkedCivilDate(request.appliedOn, 'appliedOn');

    if (!appliedOn.ok) return appliedOn;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    const application = new Application({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      applicationNumber: request.applicationNumber,
      candidateId: request.candidateId,
      vacancyId: request.vacancyId,
      status: 'received',
      sourceCode: sourceCode.value,
      appliedOn: appliedOn.value,
      metadata: metadata.value,
      version: 0,
    });

    application.raise(
      RecruitmentEvents.applicationReceived,
      {
        applicationId: application.id,
        candidateId: request.candidateId,
        vacancyId: request.vacancyId,
        sourceCode: sourceCode.value,
      },
      origin,
      occurredAt,
    );
    return accept(application);
  }

  public static rehydrate(state: ApplicationState): Application {
    return new Application(state);
  }

  public get status(): ApplicationStatus {
    return this.state.status;
  }

  public get candidateId(): string {
    return this.state.candidateId;
  }

  public get vacancyId(): string {
    return this.state.vacancyId;
  }

  public get hireState(): HireState | undefined {
    return this.state.hireState;
  }

  public get employmentId(): string | undefined {
    return this.state.employmentId;
  }

  /**
   * Moves the application through the pipeline.
   *
   * The machine is data, so the test is exhaustive over every pair rather than over the handful
   * somebody thought of. Rejection is not reachable here — it carries a reason, and a transition
   * that could reach `rejected` without one would produce an application nobody can explain.
   */
  public moveTo(
    status: Exclude<ApplicationStatus, 'rejected' | 'hired'>,
    stageCode: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<ApplicationStatus> {
    const code = checkedOptionalCode(stageCode, 'stageCode');

    if (!code.ok) return code;
    if (status === this.state.status && code.value === this.state.stageCode) {
      return refuse('application_already_in_status', { status });
    }
    if (status !== this.state.status && !this.permits(status)) {
      return refuse('application_transition_not_permitted', {
        from: this.state.status,
        to: status,
      });
    }

    const from = this.state.status;

    this.state = {
      ...this.state,
      status,
      ...(code.value === undefined ? {} : { stageCode: code.value }),
    };
    // Reopening clears the reason: an application that is live again is not a rejected one that
    // still remembers why. Removed rather than set to `undefined`, so the field is genuinely absent.
    if (status === 'received') this.state = withoutRejectionReason(this.state);
    this.raiseStatusChange(from, status, origin, occurredAt);
    return accept(status);
  }

  /** Records a screening result. Not a status by itself — `on_hold` is still `screening`. */
  public recordScreening(
    outcome: ScreeningOutcome,
    note: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<ScreeningOutcome> {
    if (isApplicationClosed(this.state.status)) {
      return refuse('application_closed', { status: this.state.status });
    }

    const checkedNote = checkedText(note, 'screeningNote', NOTE_LIMIT);

    if (!checkedNote.ok) return checkedNote;

    this.state = {
      ...this.state,
      screeningOutcome: outcome,
      ...(checkedNote.value === undefined ? {} : { screeningNote: checkedNote.value }),
    };
    this.raise(
      RecruitmentEvents.applicationStatusChanged,
      { applicationId: this.id, screeningOutcome: outcome },
      origin,
      occurredAt,
    );
    return accept(outcome);
  }

  /**
   * Rejects the application, with a reason.
   *
   * The reason is a **code**, and it is internal. What a candidate is told is Communications'
   * business and a tenant's policy; what this records is why the business decided, which is the
   * thing an equal-opportunity review asks for and the thing a free-text field makes unanalysable.
   */
  public reject(
    reasonCode: string,
    note: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<ApplicationStatus> {
    if (!this.permits('rejected')) {
      return refuse('application_transition_not_permitted', {
        from: this.state.status,
        to: 'rejected',
      });
    }

    const code = checkedCode(reasonCode, 'rejectionReasonCode');

    if (!code.ok) return code;

    const checkedNote = checkedText(note, 'note', NOTE_LIMIT);

    if (!checkedNote.ok) return checkedNote;

    const from = this.state.status;

    this.state = { ...this.state, status: 'rejected', rejectionReasonCode: code.value };
    this.raiseStatusChange(from, 'rejected', origin, occurredAt);
    this.raise(
      RecruitmentEvents.applicationRejected,
      { applicationId: this.id, candidateId: this.state.candidateId, reasonCode: code.value },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public withdraw(origin: EventOrigin, occurredAt: Date): RecruitmentResult<ApplicationStatus> {
    if (!this.permits('withdrawn')) {
      return refuse('application_transition_not_permitted', {
        from: this.state.status,
        to: 'withdrawn',
      });
    }

    const from = this.state.status;

    this.state = { ...this.state, status: 'withdrawn' };
    this.raiseStatusChange(from, 'withdrawn', origin, occurredAt);
    return accept(this.state.status);
  }

  /** Opens the hire saga. The step itself is in `application-hire.ts`. */
  public beginHire(): RecruitmentResult<HireState> {
    return this.applyStep(beganHire(this.state));
  }

  /** The person half of the saga completed. Idempotent: the same person twice is the retry path. */
  public recordPersonLinked(): RecruitmentResult<HireState> {
    return this.applyStep(personLinked(this.state));
  }

  /** The employment half completed. `employmentId` is write-once. */
  public recordEmploymentCreated(employmentId: string): RecruitmentResult<HireState> {
    return this.applyStep(employmentCreated(this.state, employmentId));
  }

  /** Takes a step's outcome, keeps the state it produced, and reports how far the saga got. */
  private applyStep(step: RecruitmentResult<HireStep>): RecruitmentResult<HireState> {
    if (!step.ok) return step;

    this.state = step.value.state;
    return accept(step.value.reached);
  }

  /** The saga completed. Only now does the application read `hired`. */
  public completeHire(origin: EventOrigin, occurredAt: Date): RecruitmentResult<ApplicationStatus> {
    if (this.state.employmentId === undefined) return refuse('hire_incomplete');

    const from = this.state.status;

    this.state = { ...this.state, status: 'hired', hireState: 'completed' };
    this.raiseStatusChange(from, 'hired', origin, occurredAt);
    return accept(this.state.status);
  }

  /**
   * Records that the saga stopped, and why.
   *
   * The application does **not** become `hired`, which is the whole point: a failed transition must
   * never look like a successful one. It stays where it was, carrying a hire state that a
   * reconciliation query finds and an operator can retry.
   */
  public failHire(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<string> {
    const checkedReason = checkedText(reason, 'hireFailureReason', 255);

    if (!checkedReason.ok) return checkedReason;

    this.state = {
      ...this.state,
      hireState: 'failed',
      ...(checkedReason.value === undefined ? {} : { hireFailureReason: checkedReason.value }),
    };
    this.raise(
      RecruitmentEvents.hireIncomplete,
      {
        applicationId: this.id,
        candidateId: this.state.candidateId,
        reachedState: this.state.hireState,
      },
      origin,
      occurredAt,
    );
    return accept(reason);
  }

  /**
   * The handoff event: an accepted offer became a Person and an Employment.
   *
   * Raised by the hire saga rather than by a status change, because it concludes work that spanned
   * three transactions and two other modules — and because Phase 7 subscribes to it, which makes
   * its payload a contract this module owes another phase.
   *
   * It names four identifiers and nothing else. No name, no address, no proposed salary: this event
   * reaches consumers this module does not know and ends up in their logs.
   */
  public raiseHired(
    hire: { readonly personId: string; readonly employmentId: string },
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.raise(
      RecruitmentEvents.candidateHired,
      {
        applicationId: this.id,
        candidateId: this.state.candidateId,
        vacancyId: this.state.vacancyId,
        personId: hire.personId,
        employmentId: hire.employmentId,
      },
      origin,
      occurredAt,
    );
  }

  public snapshot(): ApplicationState {
    return { ...this.state, version: this.version };
  }

  private permits(status: ApplicationStatus): boolean {
    return APPLICATION_TRANSITIONS[this.state.status].includes(status);
  }

  private raiseStatusChange(
    from: ApplicationStatus,
    to: ApplicationStatus,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.raise(
      RecruitmentEvents.applicationStatusChanged,
      {
        applicationId: this.id,
        candidateId: this.state.candidateId,
        vacancyId: this.state.vacancyId,
        from,
        to,
      },
      origin,
      occurredAt,
    );
  }
}
