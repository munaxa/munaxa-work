import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { RecordPlacementCommand } from '../application/calibration.use-case.js';
import type { ReadTalentMatrix } from '../application/review-queries.js';

import { RecordPlacementBody } from './review.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The nine-box: where a cycle's people sit on performance against potential.
 *
 * **Only the potential axis is supplied.** Performance comes from the review's own rating, so a
 * placement cannot flatter somebody the engine rated otherwise — the box code is derived from the
 * pair rather than typed, and a caller who could set both would be recording an opinion dressed as
 * a measurement.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/talent', version: '1' })
export class PerformanceTalentController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get('matrix')
  @ApiOperation({ summary: 'The nine-box for a cycle. Bounded' })
  public async matrix(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadTalentMatrix>({
        queryName: 'performance.talent-matrix',
        cycleId: query['cycleId'] ?? '',
        ...paged(query),
      }),
    );
  }

  @Post('placements/:reviewId')
  @ApiOperation({ summary: 'Place a review on the matrix. Performance comes from the rating' })
  public async place(
    @Param('reviewId') reviewId: string,
    @Body() body: RecordPlacementBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordPlacementCommand>({
        commandName: 'performance.record-placement',
        reviewId,
        ...body,
      }),
    );
  }
}
