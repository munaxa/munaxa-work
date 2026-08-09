import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
  AssignScheduleCommand,
  EndAssignmentCommand,
} from '../application/assignment.use-case.js';
import type {
  DefineScheduleCommand,
  PlaceShiftCommand,
  PublishScheduleCommand,
} from '../application/schedule.use-case.js';
import type { ListSchedules } from '../application/definition-queries.js';

import {
  AssignScheduleBody,
  DefineScheduleBody,
  EndAssignmentBody,
  PlaceShiftBody,
} from './definition.dto.js';
import { VersionedBody } from './attendance.dto.js';
import { AttendanceDispatcher } from './attendance-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Schedules, their cycle, and the assignments that put people on them.
 *
 * **A schedule's zone is required and has no default.** Wall-clock times mean nothing without the
 * zone they are meant in, and a defaulted one would silently file a night shift in Riyadh against
 * UTC — the exact failure this module is built to avoid (ADR-0055).
 *
 * **Moving somebody to a different schedule takes two calls**, and deliberately: the old assignment
 * is closed with a date, then the new one begins. An overlapping assignment is refused rather than
 * merged, because two schedules in force on one day is two answers to when somebody was expected.
 */
@ApiTags('attendance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such schedule in this tenant.' })
@Controller({ path: 'attendance', version: '1' })
export class AttendanceScheduleController {
  public constructor(private readonly dispatcher: AttendanceDispatcher) {}

  @Get('schedules')
  @ApiOperation({ summary: 'Every schedule, with the zone its wall-clock times are meant in' })
  @ApiOkResponse({ description: 'The schedules a tenant has defined.' })
  public async schedules(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListSchedules>({ queryName: 'attendance.list-schedules' }),
    );
  }

  @Post('schedules')
  @ApiOperation({ summary: 'Define a schedule. Its zone is required and has no default' })
  @ApiCreatedResponse({ description: 'The schedule identifier.' })
  @ApiConflictResponse({ description: 'That code is already taken in this tenant.' })
  public async defineSchedule(@Body() body: DefineScheduleBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineScheduleCommand>({
        commandName: 'attendance.define-schedule',
        ...body,
        name: { en: body.name.en, ar: body.name.ar },
      }),
    );
  }

  @Post('schedules/:scheduleId/placements')
  @ApiOperation({ summary: 'Put a shift at a cycle position. A position left empty is a rest day' })
  public async placeShift(
    @Param('scheduleId') scheduleId: string,
    @Body() body: PlaceShiftBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PlaceShiftCommand>({
        commandName: 'attendance.place-shift',
        scheduleId,
        ...body,
      }),
    );
  }

  @Post('schedules/:scheduleId/publication')
  @ApiOperation({ summary: 'Freeze a schedule' })
  public async publishSchedule(
    @Param('scheduleId') scheduleId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishScheduleCommand>({
        commandName: 'attendance.publish-schedule',
        scheduleId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post('schedules/:scheduleId/assignments')
  @ApiOperation({ summary: 'Put somebody on a schedule. Marks the days it now governs' })
  @ApiConflictResponse({ description: 'An assignment already in force covers that period.' })
  public async assign(
    @Param('scheduleId') scheduleId: string,
    @Body() body: AssignScheduleBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AssignScheduleCommand>({
        commandName: 'attendance.assign-schedule',
        scheduleId,
        ...body,
      }),
    );
  }

  @Post('assignments/:assignmentId/end')
  @ApiOperation({ summary: 'Close an assignment, which is how somebody moves schedule' })
  @ApiConflictResponse({ description: 'That assignment already has an end date.' })
  public async endAssignment(
    @Param('assignmentId') assignmentId: string,
    @Body() body: EndAssignmentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, EndAssignmentCommand>({
        commandName: 'attendance.end-assignment',
        assignmentId,
        ...body,
      }),
    );
  }
}
