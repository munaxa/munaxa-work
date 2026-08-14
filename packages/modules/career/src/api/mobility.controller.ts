import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { SearchMobilityRecommendations } from '../application/career-record-queries.js';
import type { DecideMoveCommand, RecommendMoveCommand } from '../application/mobility.use-case.js';
import type { MobilityKind, StoredMobilityStatus } from '../domain/career-vocabulary.js';

import { CareerDispatcher } from './career-dispatcher.js';
import { DecideMoveBody, RecommendMoveBody } from './career-people.dto.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Mobility recommendations: somebody suggesting a move, and somebody agreeing or not.
 *
 * **Nothing here moves anybody** (ADR-0072). `accepted` means a human agreed with a suggestion; no
 * employment changes, no position is filled, no salary is touched, and there is no port through
 * which any of that could happen. A recommendation of kind `promotion` is a *suggestion that
 * somebody be promoted* — the promotion itself is Employment's act, taken elsewhere by somebody
 * else, and this module would not know if it happened.
 *
 * **`expired` is never written and cannot be sent.** The decision body offers `proposed`, `accepted`
 * and `declined` only. Expiry is derived at the moment somebody asks, from the recommendation's own
 * `validUntil` and the day stated in the request — so the same row reads as current on one day and
 * expired on the next without anything having run (D-13). A stored flag would be right on the day it
 * was written and wrong every day after, and nothing is scheduled to keep it honest.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/mobility-recommendations', version: '1' })
export class CareerMobilityController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search recommendations. `asOf` decides what counts as expired' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchMobilityRecommendations>({
        queryName: 'career.search-recommendations',
        ...optional(query, ['employmentId', 'status', 'kind', 'asOf']),
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Suggest a move. It moves nobody' })
  public async recommend(@Body() body: RecommendMoveBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecommendMoveCommand>({
        commandName: 'career.recommend-move',
        employmentId: body.employmentId,
        kind: body.kind as MobilityKind,
        ...present({
          targetPositionId: body.targetPositionId,
          targetUnitId: body.targetUnitId,
          rationale: body.rationale,
          validUntil: body.validUntil,
        }),
      }),
    );
  }

  @Post(':mobilityRecommendationId/decision')
  @ApiOperation({ summary: 'Agree or disagree. Still moves nobody; `expired` cannot be sent' })
  public async decide(
    @Param('mobilityRecommendationId', ParseUUIDPipe) mobilityRecommendationId: string,
    @Body() body: DecideMoveBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DecideMoveCommand>({
        commandName: 'career.decide-move',
        mobilityRecommendationId,
        to: body.to as StoredMobilityStatus,
        expectedVersion: body.expectedVersion,
        ...present({ note: body.note }),
      }),
    );
  }
}
