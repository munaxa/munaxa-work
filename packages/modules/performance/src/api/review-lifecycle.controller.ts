import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ArchiveReviewCommand,
  CompleteReviewCommand,
} from '../application/review.use-case.js';
import type { ScoreReviewCommand } from '../application/score-review.use-case.js';

import { VersionedBody } from './performance.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The three acts that turn a review into a rating: scoring it, completing it, archiving it.
 *
 * **Completion is a named human's act** and has its own permission, deliberately not implied by
 * `calibrate`: moving a rating in a meeting and signing a review off are different decisions, and
 * one permission covering both would let whoever ran the meeting finalize its outcomes unreviewed.
 * `system:auto-approval` is refused by the domain and by a check constraint.
 *
 * **Completing a review makes it immutable and takes a snapshot** — the scale, the working and where
 * the work happened, frozen — so a later reorganization, a retired template or a retired scale
 * changes nothing about what the review says. The domain refuses a mutation first; the trigger is
 * the last line rather than the only one.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/reviews', version: '1' })
export class PerformanceReviewLifecycleController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Post(':reviewId/score')
  @ApiOperation({ summary: 'Score the review. Integer arithmetic, and the working is persisted' })
  @ApiOkResponse({
    description:
      'Self and peer assessments are recorded and readable and contribute nothing. A component ' +
      'nobody assessed leaves the denominator, and the exclusion is kept with its reason.',
  })
  public async score(
    @Param('reviewId') reviewId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ScoreReviewCommand>({
        commandName: 'performance.score-review',
        reviewId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':reviewId/completion')
  @ApiOperation({ summary: 'Complete a review. It becomes immutable, and a snapshot is taken' })
  @ApiOkResponse({
    description:
      'The snapshot freezes the scale, the working and where the work happened, so a later ' +
      'reorganization cannot change what the review says.',
  })
  public async complete(
    @Param('reviewId') reviewId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CompleteReviewCommand>({
        commandName: 'performance.complete-review',
        reviewId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':reviewId/archival')
  @ApiOperation({ summary: 'Archive a completed review. It stays readable' })
  public async archive(
    @Param('reviewId') reviewId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ArchiveReviewCommand>({
        commandName: 'performance.archive-review',
        reviewId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
