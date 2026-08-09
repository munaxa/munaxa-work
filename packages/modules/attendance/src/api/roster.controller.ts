import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  DefinePolicyCommand,
  PublishPolicyCommand,
  RosterCommand,
} from '../application/roster.use-case.js';
import type { ReadRoster } from '../application/definition-queries.js';

import { RosterBody, VersionedBody } from './attendance.dto.js';
import { DefinePolicyBody } from './definition.dto.js';
import { AttendanceDispatcher } from './attendance-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Rostering, and the attendance policy.
 *
 * **A roster entry is where a public holiday lives in this phase.** Organization owns calendars and
 * publishes no read for them, and the public-holiday calendar is country-pack content a later phase
 * supplies. Attendance builds no calendar of its own, because two owners of "is the 23rd a holiday"
 * produce two answers (the approved D-2 fallback).
 *
 * **Nothing statutory ships with a policy.** Every unconfigured tolerance is the inert one: a
 * shipped grace period would be this product deciding a labour-relations question for a customer
 * who never asked (00B).
 */
@ApiTags('attendance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'attendance', version: '1' })
export class AttendanceRosterController {
  public constructor(private readonly dispatcher: AttendanceDispatcher) {}

  @Get('roster')
  @ApiOperation({ summary: 'A window of the rota. A rota has no present tense, only a range' })
  @ApiOkResponse({ description: 'The entries between the two dates.' })
  public async readRoster(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadRoster>({
        queryName: 'attendance.read-roster',
        from: query['from'] ?? '',
        to: query['to'] ?? '',
        ...(query['employmentId'] === undefined ? {} : { employmentId: query['employmentId'] }),
      }),
    );
  }

  @Post('roster')
  @ApiOperation({ summary: 'Roster a day: a shift, a rest day, a holiday or off site' })
  @ApiConflictResponse({
    description: 'An entry exists on that date. Send its version to replace.',
  })
  public async roster(@Body() body: RosterBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RosterCommand>({
        commandName: 'attendance.roster',
        ...body,
      }),
    );
  }

  @Post('policies')
  @ApiOperation({ summary: 'Define an attendance policy. Every unconfigured value is inert' })
  @ApiConflictResponse({ description: 'That code is already taken in this tenant.' })
  public async definePolicy(@Body() body: DefinePolicyBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefinePolicyCommand>({
        commandName: 'attendance.define-policy',
        ...body,
        name: { en: body.name.en, ar: body.name.ar },
      }),
    );
  }

  @Post('policies/:policyId/publication')
  @ApiOperation({ summary: 'Publish a policy, marking every day it now governs' })
  public async publishPolicy(
    @Param('policyId') policyId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishPolicyCommand>({
        commandName: 'attendance.publish-policy',
        policyId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
