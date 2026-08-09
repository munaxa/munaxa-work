import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { RecordEventCommand } from '../application/ingest.use-case.js';
import type { RecalculateCommand } from '../application/recalculate.use-case.js';
import type { DaysAwaitingRecalculation } from '../application/reconciliation-query.js';
import type {
  ReadDashboard,
  ReadDay,
  SearchDays,
  SearchEvents,
} from '../application/attendance-queries.js';

import { RecalculateBody, RecordEventBody } from './attendance.dto.js';
import { AttendanceDispatcher } from './attendance-dispatcher.js';
import { dayFilters, eventFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Recording time, reading it, and asking what still needs recalculating.
 *
 * **`POST /attendance/events` is safe to send twice**, and returns 200 rather than 201 for exactly
 * that reason: a punch clock retries, and the second call is a success naming the first punch with
 * `alreadyRecorded: true`. An endpoint whose retry returns 409 is not idempotent, whatever its
 * documentation says (ADR-0053).
 *
 * **`GET /attendance/reconciliation` is on the API rather than in an operations script.** It is the
 * number that reveals a failure — days whose inputs moved and which nobody has recalculated — and a
 * number a human can see is a number a human notices growing.
 *
 * Route order matters: `reconciliation` and `dashboard` are declared before `:employmentId/:date`,
 * or Nest would match the literal segment as an identifier.
 */
@ApiTags('attendance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  public constructor(private readonly dispatcher: AttendanceDispatcher) {}

  @Post('events')
  @ApiOperation({ summary: 'Record a time event. Safe to send twice' })
  @ApiOkResponse({ description: 'The event. `alreadyRecorded` says whether this call created it.' })
  @ApiConflictResponse({ description: 'The employment had already ended.' })
  public async record(@Body() body: RecordEventBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordEventCommand>({
        commandName: 'attendance.record-event',
        ...body,
      }),
    );
  }

  @Get('events')
  @ApiOperation({ summary: 'Raw time events, with their device evidence' })
  @ApiOkResponse({
    description: 'A page of events. Its own permission, narrower than reading days.',
  })
  public async events(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchEvents>({
        queryName: 'attendance.search-events',
        ...eventFilters(query),
        ...paging(query),
      }),
    );
  }

  @Get('days')
  @ApiOperation({ summary: 'Search calculated attendance days' })
  @ApiOkResponse({ description: 'A page of days.' })
  public async days(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchDays>({
        queryName: 'attendance.search-days',
        ...dayFilters(query),
        ...paging(query),
      }),
    );
  }

  @Get('dashboard')
  @ApiOperation({ summary: "One day's counts, including how many days await recalculation" })
  @ApiOkResponse({ description: 'The counts one screen shows.' })
  public async dashboard(@Query('onDate') onDate?: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDashboard>({
        queryName: 'attendance.dashboard',
        ...(onDate === undefined ? {} : { onDate }),
      }),
    );
  }

  @Get('reconciliation')
  @ApiOperation({ summary: 'Days whose inputs moved and which nobody has recalculated' })
  @ApiOkResponse({ description: 'The outstanding queue. Growth here is a failure, visibly.' })
  public async reconciliation(@Query('limit') limit?: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, DaysAwaitingRecalculation>({
        queryName: 'attendance.days-awaiting-recalculation',
        ...(limit === undefined ? {} : { limit: Number(limit) }),
      }),
    );
  }

  @Post('recalculation')
  @ApiOperation({ summary: 'Recalculate what is marked. Idempotent, and bounded so it finishes' })
  @ApiOkResponse({ description: 'What was examined, what changed and what refused.' })
  public async recalculate(@Body() body: RecalculateBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecalculateCommand>({
        commandName: 'attendance.recalculate',
        ...body,
      }),
    );
  }

  @Get('days/:employmentId/:attendanceDate')
  @ApiOperation({ summary: 'One day, its events — superseded included — and its exceptions' })
  @ApiOkResponse({ description: 'The day in full.' })
  public async day(
    @Param('employmentId') employmentId: string,
    @Param('attendanceDate') attendanceDate: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDay>({
        queryName: 'attendance.read-day',
        employmentId,
        attendanceDate,
      }),
    );
  }
}
