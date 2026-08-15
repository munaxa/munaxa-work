import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ReadCareerSummary } from '../application/career-summary.js';

import { CareerDispatcher } from './career-dispatcher.js';
import { optional } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * One person's career standing, on a stated day.
 *
 * **The employment in the path is the subject of the question, not the identity of the asker.** This
 * route is reached with `career.plan.read` — a permission an HR administrator holds over their whole
 * tenant — and it answers about whoever is named. It is deliberately *not* `career/summary/me`:
 * there is no principal-to-employment resolution in this repository (ADR-0032), so a "me" route
 * would have to guess, and a wrong guess here returns somebody else's succession standing.
 *
 * Self-service, manager self-service and delegated access are `NOT VERIFIED`. `career.plan.read-own`
 * and `career.plan.read-team` are declared for the contract's sake and route nowhere.
 *
 * **Everything in the response is read at the moment it is asked for.** The open memberships, the
 * open nominations, the latest readiness statement and the active plans are queried against the day
 * the caller states; nothing was computed overnight and stored.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/summary', version: '1' })
export class CareerSummaryController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Get(':employmentId')
  @ApiOperation({ summary: 'Somebody’s career standing on a stated day. Not a “my career” route' })
  public async read(
    @Param('employmentId', ParseUUIDPipe) employmentId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCareerSummary>({
        queryName: 'career.read-summary',
        employmentId,
        ...optional(query, ['asOf']),
      }),
    );
  }
}
