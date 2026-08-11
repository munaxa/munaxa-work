import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  ConcludeInterviewCommand,
  RescheduleInterviewCommand,
  ScheduleInterviewCommand,
  SubmitFeedbackCommand,
} from '../application/interview.use-case.js';
import type { ReadFeedback, ReadInterviews } from '../application/pipeline-queries.js';

import {
  ConcludeInterviewBody,
  RescheduleInterviewBody,
  ScheduleInterviewBody,
  SubmitFeedbackBody,
} from './offer.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Interviews, and what the panel concluded.
 *
 * **Interviewers are employments**, each verified against Employment before an interview is
 * scheduled (A-6) — and the recruiter scheduling it does not thereby acquire permission to read the
 * employment register (ADR-0043).
 *
 * **Writing feedback is a different permission from managing interviews**, and only a member of the
 * panel may write it, once. A recruiter who could enter a score in an interviewer's name would make
 * every score worthless in a dispute; reading it is separate again, because it carries a candid
 * opinion of somebody who does not work here.
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such interview or application in this tenant.' })
@Controller({ path: 'recruitment', version: '1' })
export class InterviewsController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Get('applications/:applicationId/interviews')
  @ApiOperation({ summary: 'The interviews arranged for an application' })
  @ApiOkResponse({ description: 'Panels are employment identifiers, never names.' })
  public async list(@Param('applicationId') applicationId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadInterviews>({
        queryName: 'recruitment.read-interviews',
        applicationId,
      }),
    );
  }

  @Get('interviews/:interviewId/feedback')
  @ApiOperation({ summary: 'What the panel said. Requires recruitment.interview.feedback.read' })
  @ApiOkResponse({
    description:
      'Not aggregated: whether three fours beat one five is a hiring policy, not something this module invents.',
  })
  public async feedback(@Param('interviewId') interviewId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadFeedback>({
        queryName: 'recruitment.read-feedback',
        interviewId,
      }),
    );
  }

  @Post('interviews')
  @ApiOperation({ summary: 'Schedule an interview' })
  @ApiCreatedResponse({ description: 'The interview identifier.' })
  public async schedule(@Body() body: ScheduleInterviewBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ScheduleInterviewCommand>({
        commandName: 'recruitment.schedule-interview',
        ...body,
      }),
    );
  }

  @Post('interviews/:interviewId/schedule')
  @ApiOperation({ summary: 'Move an interview to another time' })
  public async reschedule(
    @Param('interviewId') interviewId: string,
    @Body() body: RescheduleInterviewBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RescheduleInterviewCommand>({
        commandName: 'recruitment.reschedule-interview',
        interviewId,
        ...body,
      }),
    );
  }

  @Post('interviews/:interviewId/conclusion')
  @ApiOperation({ summary: 'It happened, nobody came, or it was called off' })
  public async conclude(
    @Param('interviewId') interviewId: string,
    @Body() body: ConcludeInterviewBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ConcludeInterviewCommand>({
        commandName: 'recruitment.conclude-interview',
        interviewId,
        ...body,
      }),
    );
  }

  @Post('interviews/:interviewId/feedback')
  @ApiOperation({ summary: 'Submit an interviewer’s verdict. Once, and never edited' })
  @ApiConflictResponse({
    description: 'Not on the panel, or a verdict from this interviewer already exists.',
  })
  public async submitFeedback(
    @Param('interviewId') interviewId: string,
    @Body() body: SubmitFeedbackBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, SubmitFeedbackCommand>({
        commandName: 'recruitment.submit-interview-feedback',
        interviewId,
        ...body,
      }),
    );
  }
}
