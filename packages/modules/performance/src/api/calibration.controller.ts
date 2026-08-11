import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ConcludeCalibrationCommand,
  MoveCalibrationCommand,
  RecordCalibrationDecisionCommand,
  ScheduleCalibrationCommand,
} from '../application/calibration.use-case.js';
import type { ListCalibrationSessions } from '../application/review-queries.js';
import type { CalibrationStatus } from '../domain/performance-vocabulary.js';

import { VersionedBody } from './performance.dto.js';
import {
  MoveCalibrationBody,
  RecordCalibrationDecisionBody,
  ScheduleCalibrationBody,
} from './review.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { civilIf, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Calibration: moderating ratings in a meeting, and recording what the meeting decided.
 *
 * **There is no route that changes a calculated score.** A decision records a new number *beside*
 * the engine's, never over it: the original is what makes the moderation auditable years later, and
 * a database trigger refuses an update that changes it. The API could not offer such a route
 * without the application and the database both refusing it, and it does not offer one.
 *
 * **A reason is mandatory** and `system:auto-approval` decides nothing. A rating moved in a meeting
 * with no explanation is a rating nobody can defend when the person it belongs to asks why.
 *
 * `calibrate` and `complete` are **separate permissions**. One permission covering both would let
 * whoever ran the meeting sign off its outcomes unreviewed.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/calibration-sessions', version: '1' })
export class PerformanceCalibrationController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The calibration sessions in a cycle. Bounded' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListCalibrationSessions>({
        queryName: 'performance.calibration-sessions',
        cycleId: query['cycleId'] ?? '',
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a calibration session for a cycle' })
  public async schedule(@Body() body: ScheduleCalibrationBody): Promise<unknown> {
    const { scheduledFor, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ScheduleCalibrationCommand>({
        commandName: 'performance.schedule-calibration',
        ...rest,
        ...present({ scheduledFor: civilIf(scheduledFor) }),
      }),
    );
  }

  @Post(':calibrationSessionId/status')
  @ApiOperation({ summary: 'Open a session. Concluding one has its own route' })
  public async move(
    @Param('calibrationSessionId') calibrationSessionId: string,
    @Body() body: MoveCalibrationBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveCalibrationCommand>({
        commandName: 'performance.move-calibration',
        calibrationSessionId,
        expectedVersion: body.expectedVersion,
        status: body.status as CalibrationStatus,
      }),
    );
  }

  @Post(':calibrationSessionId/decisions')
  @ApiOperation({ summary: 'Record a moderated rating. The original is kept beside it' })
  @ApiOkResponse({
    description:
      'There is no field for the calculated score: a decision never overwrites it, and a trigger ' +
      'refuses an update that would.',
  })
  public async decide(
    @Param('calibrationSessionId') calibrationSessionId: string,
    @Body() body: RecordCalibrationDecisionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordCalibrationDecisionCommand>({
        commandName: 'performance.record-calibration-decision',
        calibrationSessionId,
        ...body,
      }),
    );
  }

  @Post(':calibrationSessionId/conclusion')
  @ApiOperation({ summary: 'Conclude a session. A named human, never the auto-approver' })
  public async conclude(
    @Param('calibrationSessionId') calibrationSessionId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ConcludeCalibrationCommand>({
        commandName: 'performance.conclude-calibration',
        calibrationSessionId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
