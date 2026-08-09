import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  RecruitmentAggregate,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
  checkedText,
  type Metadata,
} from './recruitment-aggregate.js';
import { RecruitmentEvents } from './recruitment-events.js';
import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import type { InterviewStatus, Recommendation } from './recruitment-vocabulary.js';

/**
 * An Interview: a scheduled conversation about an application.
 *
 * **Interviewers are employments** (A-6). A manager is a job and so is an interviewer, which keeps
 * "who interviewed this candidate in March" answerable after they change roles — and means this
 * module stores no copy of an employee's name, contact details or department.
 *
 * **No calendar is built here.** `scheduledFrom` and `scheduledTo` are instants and
 * `meetingReference` is opaque: a meeting link, a room booking, whatever an external system calls
 * it. Organization's calendars describe working days and holidays, not appointments, and bending
 * one into a scheduler would be the wrong reuse of the right-sounding thing.
 */

export interface InterviewState {
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly roundNumber: number;
  readonly stageCode?: string;
  readonly modeCode: string;
  readonly status: InterviewStatus;
  readonly scheduledFrom?: Date;
  readonly scheduledTo?: Date;
  readonly locationText?: string;
  readonly meetingReference?: string;
  readonly interviewerEmploymentIds: readonly string[];
  readonly cancelledReasonCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface ScheduleInterview {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly roundNumber: number;
  readonly stageCode?: string;
  readonly modeCode: string;
  readonly scheduledFrom?: Date;
  readonly scheduledTo?: Date;
  readonly locationText?: string;
  readonly meetingReference?: string;
  readonly interviewerEmploymentIds: readonly string[];
  readonly metadata?: Metadata;
}

const MAX_PANEL = 20;
const TEXT_LIMIT = 255;

export class Interview extends RecruitmentAggregate {
  private constructor(private state: InterviewState) {
    super(state.id, state.tenantId, state.version, 'Interview');
  }

  public static schedule(
    request: ScheduleInterview,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<Interview> {
    const checked = checkedSchedule(request);

    if (!checked.ok) return checked;

    const interview = new Interview({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      applicationId: request.applicationId,
      roundNumber: request.roundNumber,
      status: 'scheduled',
      ...checked.value,
      version: 0,
    });

    interview.raise(
      RecruitmentEvents.interviewScheduled,
      {
        interviewId: interview.id,
        applicationId: request.applicationId,
        roundNumber: request.roundNumber,
        interviewerEmploymentIds: checked.value.interviewerEmploymentIds,
      },
      origin,
      occurredAt,
    );
    return accept(interview);
  }

  public static rehydrate(state: InterviewState): Interview {
    return new Interview(state);
  }

  public get status(): InterviewStatus {
    return this.state.status;
  }

  public get applicationId(): string {
    return this.state.applicationId;
  }

  public get interviewerEmploymentIds(): readonly string[] {
    return this.state.interviewerEmploymentIds;
  }

  public isInterviewer(employmentId: string): boolean {
    return this.state.interviewerEmploymentIds.includes(employmentId);
  }

  public reschedule(
    window: { readonly scheduledFrom?: Date; readonly scheduledTo?: Date },
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<InterviewStatus> {
    if (this.state.status !== 'scheduled') {
      return refuse('interview_not_reschedulable', { status: this.state.status });
    }

    const checkedWindow = checkedInterviewWindow(window);

    if (!checkedWindow.ok) return checkedWindow;

    this.state = { ...this.state, ...checkedWindow.value };
    this.raise(
      RecruitmentEvents.interviewRescheduled,
      { interviewId: this.id, applicationId: this.state.applicationId },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public cancel(
    reasonCode: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<InterviewStatus> {
    if (this.state.status !== 'scheduled') {
      return refuse('interview_not_cancellable', { status: this.state.status });
    }

    const code = checkedOptionalCode(reasonCode, 'reasonCode');

    if (!code.ok) return code;

    this.state = {
      ...this.state,
      status: 'cancelled',
      ...(code.value === undefined ? {} : { cancelledReasonCode: code.value }),
    };
    this.raise(
      RecruitmentEvents.interviewCancelled,
      { interviewId: this.id, applicationId: this.state.applicationId },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  /** Completed, or nobody came. Both are outcomes; only one is a conversation. */
  public conclude(
    status: Extract<InterviewStatus, 'completed' | 'no_show'>,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<InterviewStatus> {
    if (this.state.status !== 'scheduled') {
      return refuse('interview_not_concludable', { status: this.state.status });
    }

    this.state = { ...this.state, status };
    this.raise(
      RecruitmentEvents.interviewCompleted,
      { interviewId: this.id, applicationId: this.state.applicationId, outcome: status },
      origin,
      occurredAt,
    );
    return accept(status);
  }

  public snapshot(): InterviewState {
    return { ...this.state, version: this.version };
  }
}

const checkedInterviewWindow = (window: {
  readonly scheduledFrom?: Date;
  readonly scheduledTo?: Date;
}): RecruitmentResult<{ readonly scheduledFrom?: Date; readonly scheduledTo?: Date }> => {
  if (
    window.scheduledFrom !== undefined &&
    window.scheduledTo !== undefined &&
    window.scheduledTo.getTime() <= window.scheduledFrom.getTime()
  ) {
    return refuse('interview_window_ends_before_it_begins');
  }
  return accept({
    ...(window.scheduledFrom === undefined ? {} : { scheduledFrom: window.scheduledFrom }),
    ...(window.scheduledTo === undefined ? {} : { scheduledTo: window.scheduledTo }),
  });
};

type CheckedSchedule = Omit<
  InterviewState,
  'id' | 'tenantId' | 'applicationId' | 'roundNumber' | 'status' | 'version'
>;

const checkedSchedule = (request: ScheduleInterview): RecruitmentResult<CheckedSchedule> => {
  if (!Number.isInteger(request.roundNumber) || request.roundNumber < 1) {
    return refuse('interview_round_out_of_range');
  }

  const codes = checkedInterviewCodes(request);

  if (!codes.ok) return codes;

  const panel = checkedPanel(request.interviewerEmploymentIds);

  if (!panel.ok) return panel;

  const window = checkedInterviewWindow(request);

  if (!window.ok) return window;

  const place = checkedInterviewPlace(request);

  if (!place.ok) return place;

  return accept({
    ...codes.value,
    ...window.value,
    ...place.value,
    interviewerEmploymentIds: panel.value,
  });
};

/** What kind of conversation it is, and which tenant-defined stage it belongs to. */
const checkedInterviewCodes = (
  request: ScheduleInterview,
): RecruitmentResult<Pick<CheckedSchedule, 'modeCode' | 'stageCode'>> => {
  const modeCode = checkedCode(request.modeCode, 'modeCode');

  if (!modeCode.ok) return modeCode;

  const stageCode = checkedOptionalCode(request.stageCode, 'stageCode');

  if (!stageCode.ok) return stageCode;

  return accept({
    modeCode: modeCode.value,
    ...(stageCode.value === undefined ? {} : { stageCode: stageCode.value }),
  });
};

/** Where it happens, as free text and an opaque reference. No calendar is built here. */
const checkedInterviewPlace = (
  request: ScheduleInterview,
): RecruitmentResult<Pick<CheckedSchedule, 'locationText' | 'meetingReference' | 'metadata'>> => {
  const locationText = checkedText(request.locationText, 'locationText', TEXT_LIMIT);

  if (!locationText.ok) return locationText;

  const meetingReference = checkedText(request.meetingReference, 'meetingReference', TEXT_LIMIT);

  if (!meetingReference.ok) return meetingReference;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    ...(locationText.value === undefined ? {} : { locationText: locationText.value }),
    ...(meetingReference.value === undefined ? {} : { meetingReference: meetingReference.value }),
    metadata: metadata.value,
  });
};

/** An interview nobody conducts is not an interview. De-duplicated, because a panel is a set. */
const checkedPanel = (
  interviewerEmploymentIds: readonly string[],
): RecruitmentResult<readonly string[]> => {
  const unique = [...new Set(interviewerEmploymentIds)];

  if (unique.length === 0) return refuse('interview_needs_an_interviewer');
  if (unique.length > MAX_PANEL) return refuse('interview_panel_too_large');
  return accept(unique);
};

/**
 * What an interviewer concluded.
 *
 * **Written once and never edited.** A recruiter who could amend an interviewer's score would make
 * the score worthless in a dispute, and an interviewer who could revise theirs after hearing the
 * others is not giving an independent opinion. One verdict per interviewer per interview, enforced
 * by unique index.
 *
 * **No aggregate is computed here.** Whether three fours beat one five is a hiring policy, and a
 * formula shipped in this module would be a business rule invented where the specification is
 * silent.
 */
export interface InterviewFeedbackState {
  readonly id: string;
  readonly tenantId: string;
  readonly interviewId: string;
  readonly interviewerEmploymentId: string;
  readonly score?: number;
  readonly recommendation: Recommendation;
  readonly strengths?: string;
  readonly concerns?: string;
  readonly submittedAt: Date;
  readonly version: number;
}

export interface SubmitFeedback {
  readonly tenantId: string;
  readonly interviewId: string;
  readonly interviewerEmploymentId: string;
  readonly score?: number;
  readonly recommendation: Recommendation;
  readonly strengths?: string;
  readonly concerns?: string;
}

const FEEDBACK_TEXT_LIMIT = 2048;

export const interviewFeedback = (
  request: SubmitFeedback,
  submittedAt: Date,
): RecruitmentResult<InterviewFeedbackState> => {
  if (
    request.score !== undefined &&
    (!Number.isInteger(request.score) || request.score < 1 || request.score > 5)
  ) {
    return refuse('feedback_score_out_of_range');
  }

  const strengths = checkedText(request.strengths, 'strengths', FEEDBACK_TEXT_LIMIT);

  if (!strengths.ok) return strengths;

  const concerns = checkedText(request.concerns, 'concerns', FEEDBACK_TEXT_LIMIT);

  if (!concerns.ok) return concerns;

  return accept({
    id: uuidV7(submittedAt.getTime()),
    tenantId: request.tenantId,
    interviewId: request.interviewId,
    interviewerEmploymentId: request.interviewerEmploymentId,
    ...(request.score === undefined ? {} : { score: request.score }),
    recommendation: request.recommendation,
    ...(strengths.value === undefined ? {} : { strengths: strengths.value }),
    ...(concerns.value === undefined ? {} : { concerns: concerns.value }),
    submittedAt,
    version: 0,
  });
};
