import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  RecordAssessmentItemCommand,
  StartAssessmentCommand,
  SubmitAssessmentCommand,
} from '../application/assessment.use-case.js';
import type { AssignReviewerCommand } from '../application/review.use-case.js';

import {
  AssignReviewerBody,
  RecordAssessmentItemBody,
  StartAssessmentBody,
  SubmitAssessmentBody,
} from './review.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Writing an assessment, and the 360° panel that may be asked to.
 *
 * **Inviting a reviewer and responding to an invitation are separate permissions.** Assessing
 * somebody you manage and being asked for a peer opinion are different acts with different blast
 * radii, and a reviewer invited for one review must not thereby be able to assess anybody. The
 * handler looks the invitation up: an uninvited caller is refused even holding `assess-peer`, and
 * an invitation to one review reaches that review only.
 *
 * That check had a real defect. `authorizationFor` returned a string on both success and refusal,
 * so the caller compared the wrong thing and **every invited reviewer was refused** — the panel
 * looked secure because nothing worked. It is fixed, and this route is where the regression test
 * for it runs.
 *
 * **A draft assessment is editable and a submitted one is frozen**, by the domain first and by a
 * trigger last. Recording the same line twice rewrites the draft in place rather than adding a
 * second opinion from one person.
 *
 * Self and peer assessments are **recorded, readable, and contribute nothing to the score**. There
 * is no weight for either and no field here implies one.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/reviews', version: '1' })
export class PerformanceAssessmentController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Post(':reviewId/reviewers')
  @ApiOperation({ summary: 'Invite a reviewer to the panel' })
  public async assignReviewer(
    @Param('reviewId') reviewId: string,
    @Body() body: AssignReviewerBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AssignReviewerCommand>({
        commandName: 'performance.assign-reviewer',
        reviewId,
        ...body,
      }),
    );
  }

  @Post(':reviewId/assessments')
  @ApiOperation({ summary: 'Begin an assessment. A peer must hold an invitation to this review' })
  @ApiOkResponse({
    description:
      'assessorEmploymentId names whose opinion this is, not who is signed in. It is not proof: ' +
      'the invitation is looked up, and an uninvited caller is refused.',
  })
  public async start(
    @Param('reviewId') reviewId: string,
    @Body() body: StartAssessmentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, StartAssessmentCommand>({
        commandName: 'performance.start-assessment',
        reviewId,
        ...body,
      }),
    );
  }
}

/**
 * The assessment itself, once started.
 *
 * On its own path rather than nested under the review because an assessment identifier is what a
 * reviewer holds: they were invited to one, they were given its identifier, and nothing about
 * writing their opinion requires them to name the review again.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/assessments', version: '1' })
export class PerformanceAssessmentItemController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Post(':assessmentId/items')
  @ApiOperation({ summary: 'Record one line. Recording it again rewrites the draft in place' })
  @ApiOkResponse({
    description:
      'A line either carries a score or says why it does not. An excluded line leaves the ' +
      'denominator rather than being scored zero.',
  })
  public async recordItem(
    @Param('assessmentId') assessmentId: string,
    @Body() body: RecordAssessmentItemBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordAssessmentItemCommand>({
        commandName: 'performance.record-assessment-item',
        assessmentId,
        ...body,
        itemKind: body.itemKind as RecordAssessmentItemCommand['itemKind'],
      }),
    );
  }

  @Post(':assessmentId/submission')
  @ApiOperation({ summary: 'Submit an assessment. It is frozen from here' })
  public async submit(
    @Param('assessmentId') assessmentId: string,
    @Body() body: SubmitAssessmentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, SubmitAssessmentCommand>({
        commandName: 'performance.submit-assessment',
        assessmentId,
        ...body,
      }),
    );
  }
}
