import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  ReadCompensationHistory,
  ReadEmploymentCompensation,
  ReadFutureChanges,
} from '../application/compensation-queries.js';

import { CompensationDispatcher } from './compensation-dispatcher.js';
import { paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * One employment's compensation: what it is now, what it was then, what is scheduled, and why.
 *
 * **`asOf` is a visible choice.** The current read is the same code path with today's date, so
 * there is no way to silently answer "now" to a question about "then" — the discipline
 * `EmploymentView` established.
 *
 * Every total published is **per currency**. An employment may hold a local salary and a
 * foreign-currency allowance, and summing them would require a conversion this module refuses to
 * perform.
 */
@ApiTags('compensation')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'compensation/employments', version: '1' })
export class EmploymentCompensationController {
  public constructor(private readonly dispatcher: CompensationDispatcher) {}

  @Get(':employmentId')
  @ApiOperation({ summary: "One employment's current compensation, by component and currency" })
  @ApiOkResponse({ description: 'Empty components is a real answer, not zero.' })
  public async current(@Param('employmentId') employmentId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadEmploymentCompensation>({
        queryName: 'compensation.for-employment',
        employmentId,
      }),
    );
  }

  @Get(':employmentId/as-of')
  @ApiOperation({ summary: 'Compensation as it stood on a past date' })
  public async asOf(
    @Param('employmentId') employmentId: string,
    @Query('date') date: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadEmploymentCompensation>({
        queryName: 'compensation.for-employment',
        employmentId,
        asOf: date,
      }),
    );
  }

  @Get(':employmentId/future')
  @ApiOperation({ summary: 'Changes stored and not yet effective' })
  public async future(@Param('employmentId') employmentId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadFutureChanges>({
        queryName: 'compensation.future-changes',
        employmentId,
      }),
    );
  }

  @Get(':employmentId/history')
  @ApiOperation({ summary: 'The change log — what happened, who did it and why' })
  public async history(
    @Param('employmentId') employmentId: string,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCompensationHistory>({
        queryName: 'compensation.history',
        employmentId,
        ...paging(query),
      }),
    );
  }
}
