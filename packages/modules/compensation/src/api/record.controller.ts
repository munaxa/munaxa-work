import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AmendRecurringCommand,
  AssignRecurringCommand,
  EndRecurringCommand,
} from '../application/recurring.use-case.js';
import type { RecordOneTimeCommand } from '../application/one-time.use-case.js';
import type { SearchOneTime, SearchRecurring } from '../application/compensation-queries.js';

import {
  AmendRecurringBody,
  AssignRecurringBody,
  EndRecurringBody,
  RecordOneTimeBody,
} from './record.dto.js';
import { CompensationDispatcher } from './compensation-dispatcher.js';
import { oneTimeFilters, paging, recurringFilters } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The authoritative records: what an employment receives repeatedly, and what it receives once.
 *
 * Amending is a `POST` to a sub-resource rather than a `PATCH`, and the reason is the domain's
 * rather than the API's: an amendment does not *edit* anything. It closes the period it supersedes
 * and inserts a new one, so the previous figure stays answerable for ever.
 *
 * Ending is likewise a `POST` and not a `DELETE`: nothing is deleted. The period keeps its amount
 * and gains an end date.
 */
@ApiTags('compensation')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'compensation', version: '1' })
export class CompensationRecordController {
  public constructor(private readonly dispatcher: CompensationDispatcher) {}

  @Get('recurring')
  @ApiOperation({ summary: 'The recurring compensation register, paged and filtered' })
  @ApiOkResponse({ description: 'Amounts as exact minor units in decimal strings.' })
  public async recurring(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchRecurring>({
        queryName: 'compensation.recurring',
        ...recurringFilters(query),
        ...paging(query),
      }),
    );
  }

  @Post('recurring')
  @ApiOperation({ summary: 'Assign recurring compensation, effective-dated' })
  public async assign(@Body() body: AssignRecurringBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AssignRecurringCommand>({
        commandName: 'compensation.assign-recurring',
        ...body,
      }),
    );
  }

  @Post('recurring/:recurringId/amendment')
  @ApiOperation({ summary: 'Change an amount: closes the previous period, opens a new one' })
  public async amend(
    @Param('recurringId') recurringId: string,
    @Body() body: AmendRecurringBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendRecurringCommand>({
        commandName: 'compensation.amend-recurring',
        recurringId,
        ...body,
      }),
    );
  }

  @Post('recurring/:recurringId/end')
  @ApiOperation({ summary: 'Close an entitlement. Nothing is deleted' })
  public async end(
    @Param('recurringId') recurringId: string,
    @Body() body: EndRecurringBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, EndRecurringCommand>({
        commandName: 'compensation.end-recurring',
        recurringId,
        ...body,
      }),
    );
  }

  @Get('one-time')
  @ApiOperation({ summary: 'Bonuses, commissions and awards, with their payable dates' })
  public async oneTime(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchOneTime>({
        queryName: 'compensation.one-time',
        ...oneTimeFilters(query),
        ...paging(query),
      }),
    );
  }

  @Post('one-time')
  @ApiOperation({ summary: "Record one-time compensation. Which period pays it is Payroll's" })
  public async recordOneTime(@Body() body: RecordOneTimeBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordOneTimeCommand>({
        commandName: 'compensation.record-one-time',
        ...body,
      }),
    );
  }
}
