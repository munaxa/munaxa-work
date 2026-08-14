import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiConflictResponse, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ListReadinessLevels } from '../application/career-queries.js';
import type { ReadReadinessHistory } from '../application/career-record-queries.js';
import type {
  DeactivateReadinessLevelCommand,
  DefineReadinessLevelCommand,
  RecordReadinessCommand,
} from '../application/readiness.use-case.js';

import { CareerDispatcher } from './career-dispatcher.js';
import { DefineReadinessLevelBody, RecordReadinessBody } from './career-people.dto.js';
import { VersionedBody } from './career.dto.js';
import { present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Readiness: the levels a tenant defines, and the statements people make using them.
 *
 * One prefix rather than two controllers because these are one subject — a level is meaningless
 * without the assessments that cite it, and an assessment is meaningless without the level.
 *
 * **Readiness is stated by a person and computed by nothing** (ADR-0074). There is no route here
 * that derives a level from a performance rating, a nine-box placement or a completed course count,
 * and no percentage anywhere: `readiness.record` exists because somebody looked at somebody else and
 * formed a judgement, and the record says who and when.
 *
 * **An assessment is never amended and never deleted.** There is no `PATCH`, no `DELETE` and no
 * replacement route on this controller — a database trigger refuses a mutation even if one were
 * written. "We thought she was ready in June and not in September" is the history the module exists
 * to keep, and `latest` is a *selection* of the most recent statement, never an average of two.
 *
 * **No evidence document is accepted.** Career's schema has nowhere to persist one, so a route that
 * took a document identifier and discarded it would be validation theatre. Evidence-document
 * capability is `NOT VERIFIED`.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/readiness', version: '1' })
export class CareerReadinessController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Get('levels')
  @ApiOperation({ summary: 'The tenant’s readiness levels, in ordinal order' })
  public async levels(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListReadinessLevels>({
        queryName: 'career.list-readiness-levels',
        ...(query['activeOnly'] === 'true' ? { activeOnly: true } : {}),
      }),
    );
  }

  @Post('levels')
  @ApiOperation({ summary: 'Define a level. An ordinal a human chose, not a computed score' })
  @ApiConflictResponse({ description: 'The code or the ordinal is already used in this tenant.' })
  public async defineLevel(@Body() body: DefineReadinessLevelBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineReadinessLevelCommand>({
        commandName: 'career.define-readiness-level',
        code: body.code,
        name: body.name,
        ordinal: body.ordinal,
      }),
    );
  }

  @Post('levels/:readinessLevelId/deactivation')
  @ApiOperation({ summary: 'Retire a level. Assessments that cite it stay exactly as they are' })
  public async deactivateLevel(
    @Param('readinessLevelId', ParseUUIDPipe) readinessLevelId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DeactivateReadinessLevelCommand>({
        commandName: 'career.deactivate-readiness-level',
        readinessLevelId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post('assessments')
  @ApiOperation({ summary: 'State that somebody is at a level. Immutable once written' })
  public async record(@Body() body: RecordReadinessBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordReadinessCommand>({
        commandName: 'career.record-readiness',
        employmentId: body.employmentId,
        readinessLevelId: body.readinessLevelId,
        assessedOn: body.assessedOn,
        ...present({
          positionId: body.positionId,
          successionPlanId: body.successionPlanId,
          rationale: body.rationale,
        }),
      }),
    );
  }

  @Get('history/:employmentId')
  @ApiOperation({ summary: 'Every statement made about somebody, most recent first' })
  public async history(
    @Param('employmentId', ParseUUIDPipe) employmentId: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadReadinessHistory>({
        queryName: 'career.read-readiness-history',
        employmentId,
      }),
    );
  }
}
