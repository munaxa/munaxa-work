import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { MoveReviewCommand } from '../application/review.use-case.js';
import type { ReadReview, SearchReviews } from '../application/review-queries.js';
import type { ReviewStatus } from '../domain/performance-vocabulary.js';

import { MoveReviewBody } from './review.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { optional, paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Reviews: the queue, one review with its working, and the moves that carry it to a rating.
 *
 * **A review outside the caller's scope answers 404, not 403.** Confirming that a review exists for
 * a given employment in a given cycle says that somebody is being appraised, and that is itself the
 * disclosure — a colleague who learns it has learned the thing the permission was protecting.
 *
 * **`managerEmploymentId` never establishes the caller's authority.** It is a filter honoured only
 * for a caller who could already read everything; a caller holding `review.read-team` alone reads
 * nothing, whatever they name. The scope is resolved from the caller's context and from Employment's
 * published reporting line — **never from the review being read**. Deriving it from the review's own
 * manager was a real defect in this module: every review has a manager and that manager always has
 * it among their reports, so the check passed for everybody. It was a free pass wearing the shape of
 * a check, and the regression test for it runs over this route.
 *
 * **Completion is a named human's act** and has its own permission, deliberately not implied by
 * `calibrate`: moving a rating in a meeting and signing a review off are different decisions.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/reviews', version: '1' })
export class PerformanceReviewController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The review queue. Bounded, and scoped before the store' })
  @ApiOkResponse({
    description:
      'A caller whose scope is empty receives an empty page rather than a refusal — a count of ' +
      'what was withheld is itself a disclosure.',
  })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchReviews>({
        queryName: 'performance.reviews',
        ...paged(query),
        ...optional(query, ['cycleId', 'status', 'managerEmploymentId']),
      }),
    );
  }

  @Get(':reviewId')
  @ApiOperation({
    summary: 'One review: assessments, working, panel and — once completed — snapshot',
  })
  @ApiNotFoundResponse({
    description:
      'Also the answer when the review exists but the caller is not entitled to it. 404 rather ' +
      'than 403, because confirming a review exists is the disclosure.',
  })
  public async read(
    @Param('reviewId') reviewId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadReview>({
        queryName: 'performance.read-review',
        reviewId,
        ...optional(query, ['managerEmploymentId']),
      }),
    );
  }

  @Post(':reviewId/status')
  @ApiOperation({ summary: 'Move a review. Completion and archival have their own routes' })
  public async move(
    @Param('reviewId') reviewId: string,
    @Body() body: MoveReviewBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveReviewCommand>({
        commandName: 'performance.move-review',
        reviewId,
        expectedVersion: body.expectedVersion,
        status: body.status as ReviewStatus,
      }),
    );
  }
}
