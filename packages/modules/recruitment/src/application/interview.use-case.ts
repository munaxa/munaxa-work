import { success, type Command, type CommandHandler } from '@work/kernel';

import { Interview, interviewFeedback } from '../domain/interview.js';
import type { InterviewStatus, Recommendation } from '../domain/recruitment-vocabulary.js';
import type { Metadata } from '../domain/recruitment-aggregate.js';

import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Interviews: scheduling them, and recording what the panel concluded.
 *
 * **Every interviewer is checked against Employment** (A-6). Recruitment holds no interviewer entity
 * and no copy of an employee's name: an interviewer is an employment identifier, verified through
 * Employment's own port so a panel cannot name somebody from another tenant. The check runs under a
 * bounded service grant, so a recruiter scheduling an interview does not thereby become somebody who
 * may read the employment register (ADR-0043).
 *
 * **Feedback is written by the interviewer, once.** The panel membership check is the authorization
 * that matters here: `recruitment.interview.manage` lets a recruiter arrange the conversation, and it
 * deliberately does not let them enter a score in somebody else's name.
 */

export interface ScheduleInterviewCommand extends Command {
  readonly commandName: 'recruitment.schedule-interview';
  readonly applicationId: string;
  readonly roundNumber: number;
  readonly stageCode?: string;
  readonly modeCode: string;
  readonly scheduledFrom?: string;
  readonly scheduledTo?: string;
  readonly locationText?: string;
  readonly meetingReference?: string;
  readonly interviewerEmploymentIds: readonly string[];
  readonly metadata?: Metadata;
}

export interface InterviewAffected {
  readonly interviewId: string;
  readonly status: InterviewStatus;
}

export const scheduleInterviewHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<ScheduleInterviewCommand, InterviewAffected> => ({
  commandName: 'recruitment.schedule-interview',
  permission: RecruitmentPermissions.interviewManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const application = await dependencies.stores.applications.byId(
        transaction,
        command.applicationId,
      );

      if (application === undefined) return notFound<InterviewAffected>('application');
      // Nobody interviews for a decision already made. Scheduling against a closed application
      // produces a diary entry for a conversation that will not happen.
      if (application.status === 'rejected' || application.status === 'withdrawn') {
        return conflicted('application_closed');
      }

      const panelIsReal = await everyInterviewerExists(
        dependencies,
        command.interviewerEmploymentIds,
      );

      if (!panelIsReal) return notFound<InterviewAffected>('interviewer_employment');

      const interview = Interview.schedule(
        {
          tenantId: currentTenant(),
          applicationId: command.applicationId,
          roundNumber: command.roundNumber,
          ...(command.stageCode === undefined ? {} : { stageCode: command.stageCode }),
          modeCode: command.modeCode,
          ...instantsOf(command),
          ...(command.locationText === undefined ? {} : { locationText: command.locationText }),
          ...(command.meetingReference === undefined
            ? {}
            : { meetingReference: command.meetingReference }),
          interviewerEmploymentIds: command.interviewerEmploymentIds,
          ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!interview.ok) return refusedBy(interview.error);

      await dependencies.stores.interviews.insert(transaction, interview.value.snapshot());
      transaction.collect(interview.value.pullEvents());
      return success({ interviewId: interview.value.id, status: interview.value.status });
    }),
});

/** The two instants, parsed once, so `schedule` stays inside the function budget. */
const instantsOf = (command: {
  readonly scheduledFrom?: string;
  readonly scheduledTo?: string;
}): { readonly scheduledFrom?: Date; readonly scheduledTo?: Date } => ({
  ...(command.scheduledFrom === undefined
    ? {}
    : { scheduledFrom: new Date(command.scheduledFrom) }),
  ...(command.scheduledTo === undefined ? {} : { scheduledTo: new Date(command.scheduledTo) }),
});

/**
 * Every named interviewer must be a real employment in this tenant (A-6).
 *
 * The port answers existence only, and answers it tenant-scoped, so a panel naming an employment
 * from a neighbouring customer is refused as "not found" rather than silently scheduled. The
 * recruiter does not hold the employment read permission that answers this — the module does, under
 * a bounded grant (ADR-0043).
 */
const everyInterviewerExists = async (
  dependencies: RecruitmentDependencies,
  interviewerEmploymentIds: readonly string[],
): Promise<boolean> => {
  const checks = [...new Set(interviewerEmploymentIds)].map((employmentId) =>
    dependencies.employment.exists(employmentId),
  );
  const results = await Promise.all(checks);

  return results.every(Boolean);
};

export interface RescheduleInterviewCommand extends Command {
  readonly commandName: 'recruitment.reschedule-interview';
  readonly interviewId: string;
  readonly scheduledFrom?: string;
  readonly scheduledTo?: string;
  readonly expectedVersion: number;
}

export const rescheduleInterviewHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<RescheduleInterviewCommand, InterviewAffected> => ({
  commandName: 'recruitment.reschedule-interview',
  permission: RecruitmentPermissions.interviewManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.interviews.byId(transaction, command.interviewId);

      if (state === undefined) return notFound<InterviewAffected>('interview');

      const interview = Interview.rehydrate(state);
      const moved = interview.reschedule(
        instantsOf(command),
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!moved.ok) return refusedBy(moved.error);

      await dependencies.stores.interviews.update(
        transaction,
        interview.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(interview.pullEvents());
      return success({ interviewId: interview.id, status: interview.status });
    }),
});

export interface ConcludeInterviewCommand extends Command {
  readonly commandName: 'recruitment.conclude-interview';
  readonly interviewId: string;
  readonly outcome: 'completed' | 'no_show' | 'cancelled';
  readonly reasonCode?: string;
  readonly expectedVersion: number;
}

/**
 * Ends an interview: it happened, nobody came, or it was called off.
 *
 * One handler for the three, because they are the same decision from the recruiter's side and
 * splitting them would put the version check in three places.
 */
export const concludeInterviewHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<ConcludeInterviewCommand, InterviewAffected> => ({
  commandName: 'recruitment.conclude-interview',
  permission: RecruitmentPermissions.interviewManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.interviews.byId(transaction, command.interviewId);

      if (state === undefined) return notFound<InterviewAffected>('interview');

      const interview = Interview.rehydrate(state);
      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();
      const ended =
        command.outcome === 'cancelled'
          ? interview.cancel(command.reasonCode, origin, now)
          : interview.conclude(command.outcome, origin, now);

      if (!ended.ok) return refusedBy(ended.error);

      await dependencies.stores.interviews.update(
        transaction,
        interview.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(interview.pullEvents());
      return success({ interviewId: interview.id, status: interview.status });
    }),
});

export interface SubmitFeedbackCommand extends Command {
  readonly commandName: 'recruitment.submit-interview-feedback';
  readonly interviewId: string;
  readonly interviewerEmploymentId: string;
  readonly score?: number;
  readonly recommendation: Recommendation;
  readonly strengths?: string;
  readonly concerns?: string;
}

export interface FeedbackSubmitted {
  readonly interviewId: string;
  readonly feedbackId: string;
}

/**
 * An interviewer's verdict, written once.
 *
 * **Only a member of the panel may write it**, and only one verdict each: a second submission is
 * refused here and by a unique index, so an interviewer cannot revise their score after hearing what
 * the others said. It also refuses feedback on an interview that never took place — a score for a
 * cancelled conversation is a score for a conversation nobody had.
 */
export const submitFeedbackHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<SubmitFeedbackCommand, FeedbackSubmitted> => ({
  commandName: 'recruitment.submit-interview-feedback',
  permission: RecruitmentPermissions.feedbackWrite,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.interviews.byId(transaction, command.interviewId);

      if (state === undefined) return notFound<FeedbackSubmitted>('interview');

      const interview = Interview.rehydrate(state);

      if (!interview.isInterviewer(command.interviewerEmploymentId)) {
        return conflicted('not_on_the_panel');
      }
      if (interview.status !== 'completed' && interview.status !== 'scheduled') {
        return conflicted('interview_not_open_for_feedback');
      }

      const already = await dependencies.stores.feedback.byInterviewer(
        transaction,
        command.interviewId,
        command.interviewerEmploymentId,
      );

      if (already !== undefined) return conflicted('feedback_already_submitted');

      const feedback = interviewFeedback(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!feedback.ok) return refusedBy(feedback.error);

      await dependencies.stores.feedback.insert(transaction, feedback.value);
      return success({ interviewId: command.interviewId, feedbackId: feedback.value.id });
    }),
});
