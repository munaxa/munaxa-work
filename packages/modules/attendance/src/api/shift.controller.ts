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
  AddSegmentCommand,
  DefineShiftCommand,
  PublishShiftCommand,
} from '../application/shift.use-case.js';
import type { ListShifts } from '../application/definition-queries.js';

import { AddSegmentBody, DefineShiftBody } from './definition.dto.js';
import { VersionedBody } from './attendance.dto.js';
import { AttendanceDispatcher } from './attendance-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Shifts: the pattern of hours a day is measured against.
 *
 * **Publishing is a separate endpoint under a separate permission.** A published shift is what a
 * hundred people are measured against every morning and what an auditor reads; drafting next
 * quarter's pattern is ordinary work, and the two should not need the same authority.
 *
 * **A published shift is immutable.** Adding a segment to one is refused, and a change is a new
 * version — because a day records the version it used, and editing that version in place would make
 * the record a lie.
 */
@ApiTags('attendance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such shift in this tenant.' })
@Controller({ path: 'attendance', version: '1' })
export class AttendanceShiftController {
  public constructor(private readonly dispatcher: AttendanceDispatcher) {}

  @Get('shifts')
  @ApiOperation({ summary: 'Every shift, published and draft' })
  @ApiOkResponse({ description: 'The shifts a tenant has defined.' })
  public async shifts(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListShifts>({ queryName: 'attendance.list-shifts' }),
    );
  }

  @Post('shifts')
  @ApiOperation({ summary: 'Define a shift. It is a draft until published' })
  @ApiCreatedResponse({ description: 'The shift identifier.' })
  @ApiConflictResponse({ description: 'That code is already taken in this tenant.' })
  public async defineShift(@Body() body: DefineShiftBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineShiftCommand>({
        commandName: 'attendance.define-shift',
        ...body,
        name: { en: body.name.en, ar: body.name.ar },
      }),
    );
  }

  @Post('shifts/:shiftId/segments')
  @ApiOperation({ summary: 'Add a work or break segment. Refused on a published shift' })
  public async addSegment(
    @Param('shiftId') shiftId: string,
    @Body() body: AddSegmentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AddSegmentCommand>({
        commandName: 'attendance.add-shift-segment',
        shiftId,
        ...body,
      }),
    );
  }

  @Post('shifts/:shiftId/publication')
  @ApiOperation({ summary: 'Freeze a shift. Refused with no work segment' })
  public async publishShift(
    @Param('shiftId') shiftId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishShiftCommand>({
        commandName: 'attendance.publish-shift',
        shiftId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
