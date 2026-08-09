import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AmendPlanCommand,
  CreatePlanCommand,
  RetirePlanCommand,
} from '../application/plan.use-case.js';
import type { ReadPlan, SearchPlans } from '../application/onboarding-queries.js';

import { AmendPlanBody, CreatePlanBody, VersionedBody } from './plan.dto.js';
import { OnboardingDispatcher } from './onboarding-dispatcher.js';
import { paging, planFilters } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Onboarding plans: the reusable definitions a tenant configures.
 *
 * **Nothing is shipped.** This product seeds no plan, no task and no code — a tenant that has
 * configured none gets an onboarding with no tasks and a screen that says so, which is honest.
 * Shipping a default checklist would be this product deciding how a customer inducts people, and in
 * several markets part of that answer is statutory and belongs to a country pack (00B).
 *
 * Retiring is a `POST` to a sub-resource rather than a `DELETE`, because nothing is deleted:
 * onboardings generated from a retired plan keep their tasks and keep resolving, which is what makes
 * "what were we asking of joiners last March" answerable a year later.
 */
@ApiTags('onboarding')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such plan in this tenant.' })
@Controller({ path: 'onboarding/plans', version: '1' })
export class PlansController {
  public constructor(private readonly dispatcher: OnboardingDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search onboarding plans' })
  @ApiOkResponse({ description: 'A page of plans.' })
  public async search(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchPlans>({
        queryName: 'onboarding.search-plans',
        ...planFilters(query),
        ...paging(query),
      }),
    );
  }

  @Get(':planId')
  @ApiOperation({ summary: 'One plan, its versions and the templates of each' })
  @ApiOkResponse({ description: 'The plan with its version history.' })
  public async read(@Param('planId') planId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadPlan>({ queryName: 'onboarding.read-plan', planId }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a plan. It holds no tasks — its versions do' })
  @ApiCreatedResponse({ description: 'The plan identifier.' })
  @ApiConflictResponse({ description: 'That code is already taken in this tenant.' })
  public async create(@Body() body: CreatePlanBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreatePlanCommand>({
        commandName: 'onboarding.create-plan',
        ...body,
      }),
    );
  }

  @Post(':planId/amendment')
  @ApiOperation({ summary: "Correct a plan's own details. Cannot reach a running onboarding" })
  public async amend(
    @Param('planId') planId: string,
    @Body() body: AmendPlanBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendPlanCommand>({
        commandName: 'onboarding.amend-plan',
        planId,
        ...body,
      }),
    );
  }

  @Post(':planId/retirement')
  @ApiOperation({ summary: 'Retire a plan. Onboardings generated from it are untouched' })
  public async retire(
    @Param('planId') planId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RetirePlanCommand>({
        commandName: 'onboarding.retire-plan',
        planId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
