import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  DecideCorrectionCommand,
  RequestCorrectionCommand,
  WithdrawCorrectionCommand,
} from '../application/correction.use-case.js';
import type { SearchCorrections } from '../application/definition-queries.js';

import { DecideCorrectionBody, RequestCorrectionBody, VersionedBody } from './attendance.dto.js';
import { AttendanceDispatcher } from './attendance-dispatcher.js';
import { correctionFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Correcting the record without ever rewriting a punch.
 *
 * An approved correction inserts a *new* event carrying `supersedesEventId`, or — for a removal —
 * writes no event at all and lets the correction record be the tombstone. The original stays in the
 * table, readable, exactly as it was captured (ADR-0052).
 *
 * **Requesting and deciding are separate endpoints under separate permissions, and the domain
 * refuses self-approval regardless.** A separation that depends on nobody holding two roles is a
 * separation that fails the first time somebody does — and on a small team somebody always does.
 * The database says the same thing with a check constraint.
 */
@ApiTags('attendance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such correction in this tenant.' })
@Controller({ path: 'attendance', version: '1' })
export class AttendanceCorrectionController {
  public constructor(private readonly dispatcher: AttendanceDispatcher) {}

  @Get('corrections')
  @ApiOperation({ summary: 'The correction queue: who asked, who decided, and what it produced' })
  @ApiOkResponse({ description: 'A page of corrections.' })
  public async corrections(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchCorrections>({
        queryName: 'attendance.search-corrections',
        ...correctionFilters(query),
        ...paging(query),
      }),
    );
  }

  @Post('corrections')
  @ApiOperation({ summary: 'Ask for a correction. Requesting is never deciding' })
  @ApiCreatedResponse({ description: 'The correction request.' })
  public async request(@Body() body: RequestCorrectionBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RequestCorrectionCommand>({
        commandName: 'attendance.request-correction',
        ...body,
      }),
    );
  }

  @Post('corrections/:correctionId/decision')
  @ApiOperation({ summary: 'Decide a correction. Refused when the decider requested it' })
  @ApiUnprocessableEntityResponse({ description: 'Self-approval, or a request already decided.' })
  public async decide(
    @Param('correctionId') correctionId: string,
    @Body() body: DecideCorrectionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DecideCorrectionCommand>({
        commandName: 'attendance.decide-correction',
        correctionId,
        ...body,
      }),
    );
  }

  @Post('corrections/:correctionId/withdrawal')
  @ApiOperation({ summary: 'Withdraw a request. The record of having asked stays' })
  public async withdraw(
    @Param('correctionId') correctionId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, WithdrawCorrectionCommand>({
        commandName: 'attendance.withdraw-correction',
        correctionId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
