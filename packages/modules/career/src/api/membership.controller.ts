import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { SearchPoolMemberships } from '../application/career-record-queries.js';
import type { RemoveFromTalentPoolCommand } from '../application/pool.use-case.js';

import { CareerDispatcher } from './career-dispatcher.js';
import { RemoveFromPoolBody } from './career.dto.js';
import { flag, optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Who was in a pool, and when.
 *
 * Its own prefix rather than a branch of `career/pools` because a membership outlives the question
 * "what is in this pool right now": `inForceOn` asks who was in it on a stated civil day, both ends
 * inclusive, which is the read a succession review actually makes. A route nested under a pool would
 * make the historical question the awkward one.
 *
 * **Removal ends a membership and deletes nothing.** "This person was in the leadership pool from
 * April to October" is the fact a review needs a year later, and a deleted row cannot answer it — so
 * the route is a `removal` sub-resource carrying the day it ended, not a `DELETE`.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/pool-memberships', version: '1' })
export class CareerMembershipController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search memberships. Bounded. `inForceOn` asks about a stated day' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchPoolMemberships>({
        queryName: 'career.search-pool-memberships',
        ...optional(query, ['talentPoolId', 'employmentId', 'inForceOn']),
        ...flag(query, 'openOnly'),
        ...paged(query),
      }),
    );
  }

  @Post(':membershipId/removal')
  @ApiOperation({ summary: 'End a membership on a stated day. Not a deletion' })
  public async remove(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() body: RemoveFromPoolBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RemoveFromTalentPoolCommand>({
        commandName: 'career.remove-from-pool',
        membershipId,
        on: body.on,
        expectedVersion: body.expectedVersion,
        ...present({ reason: body.reason }),
      }),
    );
  }
}
