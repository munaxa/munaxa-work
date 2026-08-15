import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { SearchCareerPlans } from '../application/career-record-queries.js';
import type {
  AmendCareerPlanCommand,
  CreateCareerPlanCommand,
  MoveCareerPlanCommand,
} from '../application/plan.use-case.js';
import type { CareerPlanStatus } from '../domain/career-vocabulary.js';

import { AmendPlanBody, CreatePlanBody, MovePlanBody } from './career.dto.js';
import { CareerDispatcher } from './career-dispatcher.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * A named person's career plan: where they are on a path and where they are going.
 *
 * **`employmentId` is a subject and never a credential.** It says *whose* plan this is, and it is a
 * filter on the search rather than proof of who is asking. A caller holding `career.plan.read` sees
 * their tenant's plans whatever employment they name; a caller holding nothing sees a 403. There is
 * no "my career" route here and there will not be one until a principal can be resolved to an
 * employment (ADR-0032) — an endpoint that read the identifier as identity would let anybody read
 * anybody's succession standing by changing a number in a URL. Self-service is `NOT VERIFIED`.
 *
 * **Moving a plan is a `POST` to `status` with the target named and the version stated.** The five
 * statuses are one aggregate's lifecycle rather than five distinct acts, which is the case the
 * repository already answers this way; what is not offered is a generic `PATCH` that writes a column
 * without a rule.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/plans', version: '1' })
export class CareerPlanController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search plans. Bounded. `employmentId` is a filter, not an identity' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchCareerPlans>({
        queryName: 'career.search-plans',
        ...optional(query, ['employmentId', 'pathId', 'status']),
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Open a plan for somebody. The employment is confirmed upstream' })
  public async create(@Body() body: CreatePlanBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateCareerPlanCommand>({
        commandName: 'career.create-plan',
        employmentId: body.employmentId,
        startedOn: body.startedOn,
        ...present({
          pathId: body.pathId,
          currentStageId: body.currentStageId,
          targetStageId: body.targetStageId,
          targetDate: body.targetDate,
          notes: body.notes,
        }),
      }),
    );
  }

  @Post(':careerPlanId/amendment')
  @ApiOperation({ summary: 'Change where the plan is aiming. The status is not touched here' })
  public async amend(
    @Param('careerPlanId', ParseUUIDPipe) careerPlanId: string,
    @Body() body: AmendPlanBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendCareerPlanCommand>({
        commandName: 'career.amend-plan',
        careerPlanId,
        expectedVersion: body.expectedVersion,
        ...present({
          currentStageId: body.currentStageId,
          targetStageId: body.targetStageId,
          targetDate: body.targetDate,
          notes: body.notes,
        }),
      }),
    );
  }

  @Post(':careerPlanId/status')
  @ApiOperation({ summary: 'Move a plan. An illegal transition is refused by name, not by 500' })
  public async move(
    @Param('careerPlanId', ParseUUIDPipe) careerPlanId: string,
    @Body() body: MovePlanBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveCareerPlanCommand>({
        commandName: 'career.move-plan',
        careerPlanId,
        to: body.to as CareerPlanStatus,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
