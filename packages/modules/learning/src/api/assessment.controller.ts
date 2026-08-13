import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { DefineAssessmentCommand } from '../application/catalogue.use-case.js';
import type { RecordAssessmentResultCommand } from '../application/assessment.use-case.js';
import type { AssessmentKind, AssessmentOutcome } from '../domain/learning-vocabulary.js';

import { DefineAssessmentBody, RecordAssessmentResultBody } from './learner.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What a course version asks somebody to demonstrate.
 *
 * An assessment belongs to a *version*, not to a course, which is why it is created under this
 * prefix rather than under `learning/courses`: a course that is revised asks something different,
 * and an assessment that moved with the course would misdescribe what somebody sat last year.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/course-versions', version: '1' })
export class LearningCourseVersionController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Post(':courseVersionId/assessments')
  @ApiOperation({ summary: 'Define an assessment. A kind and a title — no pass mark, no weight' })
  public async define(
    @Param('courseVersionId') courseVersionId: string,
    @Body() body: DefineAssessmentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineAssessmentCommand>({
        commandName: 'learning.define-assessment',
        courseVersionId,
        title: body.title,
        kind: body.kind as AssessmentKind,
        required: body.required,
      }),
    );
  }
}

/**
 * Recording what an assessor observed.
 *
 * **A result is appended and never rewritten** — a database trigger refuses an update — so the
 * record of what happened on the day stays what happened on the day.
 *
 * **Nothing here scores anything.** There is no route that totals results, averages them, applies a
 * threshold or produces a verdict over a set, because the specification defines no formula and
 * inventing one would decide who passes mandatory safety training on a rule nobody wrote. Aggregate
 * assessment scoring is `NOT VERIFIED`. The mark an assessor supplies is carried as the text they
 * typed: `18.50` is stored, returned and read as `18.50`.
 *
 * There is no route to *read* results here. They are read against the enrolment they belong to —
 * see `learning/enrolments/:enrolmentId/assessment-results` — because that is the object whose
 * visibility the application scopes.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/assessments', version: '1' })
export class LearningAssessmentController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Post(':assessmentId/results')
  @ApiOperation({ summary: 'Record an outcome. Stated by an assessor; nothing computes it' })
  public async record(
    @Param('assessmentId') assessmentId: string,
    @Body() body: RecordAssessmentResultBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordAssessmentResultCommand>({
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId: body.enrolmentId,
        outcome: body.outcome as AssessmentOutcome,
        assessedOn: body.assessedOn,
        // Carried, not converted. `present` keeps the string exactly as it arrived.
        ...present({
          rawMark: body.rawMark,
          rawMarkScale: body.rawMarkScale,
          notes: body.notes,
        }),
      }),
    );
  }
}
