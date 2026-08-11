import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  ApproveDayCommand,
  ResolveExceptionCommand,
  ReviewDayCommand,
} from '../application/day.use-case.js';
import type { SearchExceptions } from '../application/attendance-queries.js';

import { ResolveExceptionBody, VersionedBody } from './attendance.dto.js';
import { AttendanceDispatcher } from './attendance-dispatcher.js';
import { exceptionFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Reviewing a day, signing it off, and resolving what the calculation found.
 *
 * Sign-off is a `POST` to a sub-resource rather than a `PATCH` of a state field: approving a day is
 * a decision by a named human, and the response records who and when. It is **refused while a
 * blocking exception is open** — a day whose clock-out never arrived has no defensible worked
 * figure, and approving one would put a number nobody can justify into a payable snapshot.
 *
 * Resolving and waiving are the same endpoint with different outcomes, because "we dealt with it"
 * and "it did not apply to this person" are different answers and the second is the one an auditor
 * asks about. Neither deletes anything.
 */
@ApiTags('attendance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'attendance', version: '1' })
export class AttendanceDayController {
  public constructor(private readonly dispatcher: AttendanceDispatcher) {}

  @Get('exceptions')
  @ApiOperation({ summary: 'The exception queue an administrator lives in' })
  @ApiOkResponse({ description: 'A page of exceptions.' })
  public async exceptions(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchExceptions>({
        queryName: 'attendance.search-exceptions',
        ...exceptionFilters(query),
        ...paging(query),
      }),
    );
  }

  @Post('days/:attendanceDayId/review')
  @ApiOperation({ summary: 'Take a day out of the automatic flow so a human is looking at it' })
  public async review(
    @Param('attendanceDayId') attendanceDayId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReviewDayCommand>({
        commandName: 'attendance.review-day',
        attendanceDayId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post('days/:attendanceDayId/approval')
  @ApiOperation({ summary: 'Sign a day off. Refused while a blocking exception is open' })
  @ApiUnprocessableEntityResponse({
    description: 'A day whose clock-out never arrived has no defensible worked figure.',
  })
  public async approve(
    @Param('attendanceDayId') attendanceDayId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ApproveDayCommand>({
        commandName: 'attendance.approve-day',
        attendanceDayId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post('exceptions/:exceptionId/resolution')
  @ApiOperation({ summary: 'Resolve or waive an exception. Neither deletes anything' })
  public async resolve(
    @Param('exceptionId') exceptionId: string,
    @Body() body: ResolveExceptionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ResolveExceptionCommand>({
        commandName: 'attendance.resolve-exception',
        exceptionId,
        ...body,
      }),
    );
  }
}
