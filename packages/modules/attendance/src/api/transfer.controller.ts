import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { FreezePeriodCommand } from '../application/snapshot.use-case.js';
import type { ExportAttendance, ImportEventsCommand } from '../application/transfer.use-case.js';
import type { ReadSnapshots } from '../application/attendance-queries.js';
import type { ListImports } from '../application/definition-queries.js';

import { FreezePeriodBody } from './attendance.dto.js';
import { ImportEventsBody } from './definition.dto.js';
import { AttendanceDispatcher } from './attendance-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Getting punches in, and getting the register out.
 *
 * **Import is bounded and synchronous, and it refuses by name beyond the bound.** A request that
 * timed out half way through a month of turnstile data would leave an operator guessing what
 * landed; a refusal tells them to split the file. A re-run is free — every row deduplicates.
 *
 * **A freeze produces the next sequence rather than editing the last one.** A correction after a
 * freeze must not rewrite what Payroll already read, so what was paid and what is now true both
 * stay readable (ADR-0054).
 *
 * **Export is its own permission, held by fewer people than read.** It is the highest-volume
 * disclosure this module can make, and it carries no punch location, no device identifier and no
 * justification text for exactly that reason.
 */
@ApiTags('attendance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'attendance', version: '1' })
export class AttendanceTransferController {
  public constructor(private readonly dispatcher: AttendanceDispatcher) {}

  @Get('imports')
  @ApiOperation({ summary: 'What the recent imports did, row by row' })
  @ApiOkResponse({ description: 'Recent batches and their counts.' })
  public async imports(@Query('limit') limit?: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListImports>({
        queryName: 'attendance.list-imports',
        ...(limit === undefined ? {} : { limit: Number(limit) }),
      }),
    );
  }

  @Post('imports')
  @ApiOperation({ summary: 'Import normalized punches. A re-run skips rather than duplicates' })
  @ApiOkResponse({ description: 'What was created, what was skipped and what failed, by row.' })
  @ApiConflictResponse({ description: 'The batch is larger than one request may carry.' })
  public async importEvents(@Body() body: ImportEventsBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ImportEventsCommand>({
        commandName: 'attendance.import-events',
        ...body,
      }),
    );
  }

  @Post('periods/freeze')
  @ApiOperation({ summary: 'Freeze a period into the snapshot Payroll reads' })
  @ApiOkResponse({ description: 'The snapshot, with its sequence and its completeness counts.' })
  @ApiConflictResponse({ description: 'A day in the period is still awaiting recalculation.' })
  public async freeze(@Body() body: FreezePeriodBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, FreezePeriodCommand>({
        commandName: 'attendance.freeze-period',
        ...body,
      }),
    );
  }

  @Get('snapshots')
  @ApiOperation({ summary: 'The frozen figures for a period. What Payroll reads' })
  @ApiOkResponse({
    description: 'Every sequence, so what was paid and what is now true both show.',
  })
  public async snapshots(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadSnapshots>({
        queryName: 'attendance.read-snapshots',
        periodStart: query['periodStart'] ?? '',
        periodEnd: query['periodEnd'] ?? '',
        ...(query['employmentId'] === undefined ? {} : { employmentId: query['employmentId'] }),
      }),
    );
  }

  @Get('export')
  @ApiOperation({ summary: 'The attendance register. Bounded, and refuses rather than truncating' })
  @ApiOkResponse({ description: 'Days only: no location, no device, no note.' })
  @ApiConflictResponse({ description: 'The range holds more days than one export may carry.' })
  public async export(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ExportAttendance>({
        queryName: 'attendance.export',
        from: query['from'] ?? '',
        to: query['to'] ?? '',
      }),
    );
  }
}
