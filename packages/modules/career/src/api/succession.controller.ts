import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ReadSuccessionPlan, SearchSuccessionPlans } from '../application/career-queries.js';
import type { ReadBenchStrength } from '../application/career-record-queries.js';
import type { CreateSuccessionPlanCommand } from '../application/succession.use-case.js';

import { CareerDispatcher } from './career-dispatcher.js';
import { CreateSuccessionPlanBody } from './career-people.dto.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Succession plans: a bench of named people against a named position.
 *
 * **This is the most disclosing data in the module, and the routes are shaped by that.** A plan the
 * caller may not see answers **404 rather than 403** — "you may not see this bench" confirms the
 * bench exists, and for a director's post that is most of the secret. The application decides it;
 * the wire repeats it.
 *
 * **The position is named, never discovered.** `positionId` is a filter over Career's own plans, and
 * the only thing Career ever asks Organization is whether one exact identifier is a position in this
 * tenant. There is no criticality here: no filter accepts one, no response carries one, and
 * enumerating a tenant's critical positions remains `NOT VERIFIED` (D-4).
 *
 * **`reviewDueBy` is a question, not a schedule** (D-16). It asks which active plans have a review
 * day on or before a stated civil day. Nothing fires, nothing is queued and nobody is notified —
 * scheduled review is `NOT VERIFIED`, and a route that implied otherwise would be a promise the
 * product does not keep.
 *
 * The state-changing routes on this same prefix are `CareerSuccessionLifecycleController`, declared
 * immediately after this one. Two controllers on one prefix is the arrangement Learning uses for
 * enrolments, and the split is along a real seam: everything here answers a question, and everything
 * there changes what the organization has committed to.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/succession-plans', version: '1' })
export class CareerSuccessionController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search benches. Bounded. `reviewDueBy` asks; nothing fires' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchSuccessionPlans>({
        queryName: 'career.search-succession-plans',
        ...optional(query, ['positionId', 'status', 'reviewDueBy', 'asOf']),
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Open a bench for a position. The position is confirmed upstream' })
  public async create(@Body() body: CreateSuccessionPlanBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateSuccessionPlanCommand>({
        commandName: 'career.create-succession-plan',
        positionId: body.positionId,
        ...present({ reviewOn: body.reviewOn, notes: body.notes }),
      }),
    );
  }

  @Get(':successionPlanId')
  @ApiOperation({ summary: 'One bench with its nominations' })
  @ApiNotFoundResponse({ description: 'Another tenant’s plan is not found here, never forbidden.' })
  public async read(
    @Param('successionPlanId', ParseUUIDPipe) successionPlanId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadSuccessionPlan>({
        queryName: 'career.read-succession-plan',
        successionPlanId,
        ...optional(query, ['asOf']),
      }),
    );
  }

  @Get(':successionPlanId/bench-strength')
  @ApiOperation({ summary: 'How many are nominated and confirmed. Counted, never scored' })
  public async benchStrength(
    @Param('successionPlanId', ParseUUIDPipe) successionPlanId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadBenchStrength>({
        queryName: 'career.read-bench-strength',
        successionPlanId,
        ...optional(query, ['asOf']),
      }),
    );
  }
}
