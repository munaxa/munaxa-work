import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { RunAccrualCommand } from '../application/accrual.use-case.js';
import type { CloseLeaveYearCommand } from '../application/leave-year.use-case.js';
import type { ExpireCarryOverCommand } from '../application/expiry.use-case.js';
import type { ListAccrualRuns } from '../application/definition-queries.js';

import { LeaveYearBody, RunAccrualBody } from './leave.dto.js';
import { LeaveDispatcher } from './leave-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The three bounded runs: accrual, leave-year closure, and carry-over expiry.
 *
 * **None of them is scheduled, and nothing here pretends otherwise.** Nothing in this repository
 * runs on a timer; scheduling is Phase 24's. An operator invokes these, and each reports what it
 * covered — including how many it *skipped*, which is the count that demonstrates the run is
 * idempotent rather than merely claimed to be.
 *
 * Re-invoking a run for a period it has already covered is not a conflict: it resumes the same run
 * and writes nothing it already wrote. Closing a leave year twice **is** a conflict, because the
 * second closure would produce a second carry pair.
 */
@ApiTags('leave')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'leave', version: '1' })
export class LeaveRunController {
  public constructor(private readonly dispatcher: LeaveDispatcher) {}

  @Get('accrual-runs')
  @ApiOperation({ summary: 'What each run covered, wrote, skipped and refused' })
  public async runs(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListAccrualRuns>({
        queryName: 'leave.accrual-runs',
        ...(query['limit'] === undefined ? {} : { limit: Number(query['limit']) }),
      }),
    );
  }

  @Post('accrual-runs')
  @ApiOperation({ summary: 'Run accrual over a page of employments. Bounded and restartable' })
  public async accrue(@Body() body: RunAccrualBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RunAccrualCommand>({
        commandName: 'leave.run-accrual',
        ...body,
      }),
    );
  }

  @Post('leave-years/closure')
  @ApiOperation({ summary: 'Close a leave year. Writes the carry pair; deletes nothing' })
  public async closeYear(@Body() body: LeaveYearBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CloseLeaveYearCommand>({
        commandName: 'leave.close-leave-year',
        ...body,
      }),
    );
  }

  @Post('carry-over/expiry')
  @ApiOperation({ summary: 'Expire carried-over leave whose date has passed' })
  public async expire(@Body() body: LeaveYearBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ExpireCarryOverCommand>({
        commandName: 'leave.expire-carry-over',
        ...body,
      }),
    );
  }
}
