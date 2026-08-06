import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AmendCalendarCommand,
  DefineCalendarCommand,
  RecordCalendarDayCommand,
  RemoveCalendarDayCommand,
} from '../application/calendar.use-case.js';

import { AmendCalendarBody, DefineCalendarBody, RecordCalendarDayBody } from './planning.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Organizational calendars and their exception days.
 *
 * Attendance and Leave consume these from Phase 8. Organization calculates nothing.
 *
 * There is no endpoint that seeds a country's holidays, and there will not be. Which dates a
 * country observes is country pack content or the tenant's own decision, loaded through
 * `record-day` like any other data — a "seed Saudi holidays" endpoint would put a country into
 * this module's source, which 00B prohibits outright.
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'organization', version: '1' })
export class CalendarsController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Post('calendars')
  @ApiOperation({ summary: 'Define a calendar and its working week. There is no default week' })
  @ApiOkResponse({ description: 'The calendar.' })
  public async define(@Body() body: DefineCalendarBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.define-calendar',
        code: body.code,
        name: body.name,
        ...(body.unitId === undefined ? {} : { unitId: body.unitId }),
        timeZone: body.timeZone,
        workingDays: body.workingDays,
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies DefineCalendarCommand),
    );
  }

  @Patch('calendars/:calendarId')
  @ApiOperation({ summary: 'Amend a calendar' })
  @ApiOkResponse({ description: 'The calendar.' })
  public async amend(
    @Param('calendarId') calendarId: string,
    @Body() body: AmendCalendarBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.amend-calendar',
        calendarId,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone }),
        ...(body.workingDays === undefined ? {} : { workingDays: body.workingDays }),
        expectedVersion: body.expectedVersion,
      } satisfies AmendCalendarCommand),
    );
  }

  @Post('calendars/:calendarId/days')
  @ApiOperation({
    summary: 'Record what one date is: a holiday, a working day, or a non-working day',
    description:
      "The date is civil, in the calendar's own time zone. A holiday is a day in a place, not " +
      'a moment — stored as an instant it lands a day out for anybody east or west of it.',
  })
  @ApiOkResponse({ description: 'The recorded day.' })
  public async recordDay(
    @Param('calendarId') calendarId: string,
    @Body() body: RecordCalendarDayBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.record-calendar-day',
        calendarId,
        onDate: body.onDate,
        kind: body.kind,
        name: body.name,
      } satisfies RecordCalendarDayCommand),
    );
  }

  @Delete('calendars/:calendarId/days/:onDate')
  @ApiOperation({ summary: 'Remove a recorded day' })
  @ApiOkResponse({ description: 'The removed day.' })
  public async removeDay(
    @Param('calendarId') calendarId: string,
    @Param('onDate') onDate: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.remove-calendar-day',
        calendarId,
        onDate,
      } satisfies RemoveCalendarDayCommand),
    );
  }
}
