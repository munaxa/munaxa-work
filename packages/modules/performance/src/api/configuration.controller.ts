import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  DefineGoalCategoryCommand,
  DefineRatingScaleCommand,
  RetireRatingScaleCommand,
  SetGoalCategoryActiveCommand,
} from '../application/configuration.use-case.js';
import type { ListGoalCategories, ListRatingScales } from '../application/performance-queries.js';

import {
  DefineGoalCategoryBody,
  DefineRatingScaleBody,
  SetGoalCategoryActiveBody,
  VersionedBody,
} from './performance.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { civil, civilIf, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Rating scales and goal categories: the vocabulary a tenant rates against.
 *
 * Authorization is **not** decided here. Each application handler declares the permission it
 * requires and the kernel's pipeline enforces it before the handler runs, so a controller cannot
 * accidentally widen access by forgetting a guard — and cannot narrow it either.
 *
 * A scale is **retired, never deleted**. Completed reviews carry a frozen copy of the scale they
 * were rated against, so retiring one changes nothing that has already happened; deleting one would
 * make a historical rating unreadable, which is the outcome this module exists to prevent.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/rating-scales', version: '1' })
export class PerformanceRatingScaleController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The rating scales, with their levels. Bounded' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListRatingScales>({
        queryName: 'performance.rating-scales',
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a scale and its levels. Scores are hundredths' })
  @ApiOkResponse({ description: 'The domain refuses overlapping or non-contiguous bands.' })
  public async define(@Body() body: DefineRatingScaleBody): Promise<unknown> {
    const { effectiveFrom, effectiveTo, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineRatingScaleCommand>({
        commandName: 'performance.define-rating-scale',
        ...rest,
        effectiveFrom: civil(effectiveFrom),
        ...present({ effectiveTo: civilIf(effectiveTo) }),
      }),
    );
  }

  @Post(':ratingScaleId/retirement')
  @ApiOperation({
    summary: 'Retire a scale. Completed reviews keep the copy they were rated against',
  })
  public async retire(
    @Param('ratingScaleId') ratingScaleId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RetireRatingScaleCommand>({
        commandName: 'performance.retire-rating-scale',
        ratingScaleId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}

@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/goal-categories', version: '1' })
export class PerformanceGoalCategoryController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The goal categories. Bounded' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListGoalCategories>({
        queryName: 'performance.goal-categories',
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a goal category' })
  public async define(@Body() body: DefineGoalCategoryBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineGoalCategoryCommand>({
        commandName: 'performance.define-goal-category',
        ...body,
      }),
    );
  }

  @Patch(':goalCategoryId')
  @ApiOperation({ summary: 'Take a category out of use, or put it back' })
  public async setActive(
    @Param('goalCategoryId') goalCategoryId: string,
    @Body() body: SetGoalCategoryActiveBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, SetGoalCategoryActiveCommand>({
        commandName: 'performance.set-goal-category-active',
        goalCategoryId,
        ...body,
      }),
    );
  }
}
