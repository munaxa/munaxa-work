import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { EnrolCommand } from '../application/enrolment.use-case.js';
import type {
  ReadAssessmentResults,
  SearchEnrolments,
} from '../application/learning-record-queries.js';

import { EnrolBody } from './learner.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Somebody's attempt at a course: reading it, creating it, and reading what was assessed on it.
 *
 * The moves an enrolment makes — starting, completing, failing, withdrawing — are in
 * `LearningEnrolmentLifecycleController`, on the same prefix. That is a real seam rather than a
 * file-size one: this controller reads and creates, that one changes state, and the two are
 * governed by different permissions — `enrolment.complete` is deliberately not implied by
 * `enrolment.manage`, because recording that somebody finished is the evidence a certificate is
 * issued from and what a safety audit reads.
 *
 * **The course version is not on the wire.** An enrolment pins whichever version is current when it
 * is created, so what somebody sat stays describable after the course is revised (AD-004). A
 * caller-supplied version would let a client enrol somebody onto content nobody is delivering.
 *
 * **Enrolling twice is not an error.** The same person on the same course converges on one
 * enrolment rather than creating a second: the result says whether it was created, and a client
 * that retried a timed-out request gets the enrolment it already has.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/enrolments', version: '1' })
export class LearningEnrolmentController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search enrolments. Scoped before it is filtered, and bounded' })
  @ApiOkResponse({ description: 'A caller with no resolvable scope receives an empty page.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchEnrolments>({
        queryName: 'learning.search-enrolments',
        ...paged(query),
        ...optional(query, ['employmentId', 'courseId', 'status']),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Enrol somebody. The current course version is pinned, never supplied' })
  @ApiConflictResponse({ description: 'The course has no published version to pin.' })
  public async enrol(@Body() body: EnrolBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, EnrolCommand>({
        commandName: 'learning.enrol',
        employmentId: body.employmentId,
        courseId: body.courseId,
        ...present({ assignmentId: body.assignmentId }),
      }),
    );
  }

  @Get(':enrolmentId/assessment-results')
  @ApiOperation({ summary: 'The outcomes recorded against one enrolment, exactly as recorded' })
  @ApiOkResponse({
    description:
      'Nothing is totalled: no average, no percentage, no verdict over the set. The specification ' +
      'defines no formula, and aggregate scoring is NOT VERIFIED.',
  })
  public async results(@Param('enrolmentId') enrolmentId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadAssessmentResults>({
        queryName: 'learning.read-assessment-results',
        enrolmentId,
      }),
    );
  }
}
