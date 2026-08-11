import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
  MoveApplicationCommand,
  SubmitApplicationCommand,
} from '../application/application.use-case.js';
import type {
  CloseApplicationCommand,
  RecordScreeningCommand,
} from '../application/application-outcome.use-case.js';
import type { ReadApplication, SearchApplications } from '../application/pipeline-queries.js';

import {
  CloseApplicationBody,
  MoveApplicationBody,
  RecordScreeningBody,
  SubmitApplicationBody,
} from './candidate.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { applicationFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Applications, and every movement through the pipeline.
 *
 * **One application per candidate per vacancy**: re-applying reopens the one they already have, and
 * the response says so. **Every movement writes a history row in the same transaction**, so a
 * history cannot be missing for exactly the change somebody later disputes.
 *
 * `unfinishedHire=true` is the **reconciliation query**: every hire that started and did not finish
 * (ADR-0046). It is on the ordinary search rather than hidden in an operations tool, because a
 * half-finished hire is a fact recruiters need to see too.
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such application in this tenant.' })
@Controller({ path: 'recruitment/applications', version: '1' })
export class ApplicationsController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search applications, including unfinished hires' })
  @ApiOkResponse({ description: 'A page of applications.' })
  public async search(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchApplications>({
        queryName: 'recruitment.search-applications',
        ...applicationFilters(query),
        ...(query['unfinishedHire'] === 'true' ? { unfinishedHire: true } : {}),
        ...paging(query),
      }),
    );
  }

  @Get(':applicationId')
  @ApiOperation({ summary: 'One application: its history, interviews and offers' })
  public async read(@Param('applicationId') applicationId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadApplication>({
        queryName: 'recruitment.read-application',
        applicationId,
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Submit an application. Re-applying reopens the existing one' })
  @ApiCreatedResponse({ description: 'The application, and whether it was reopened.' })
  @ApiConflictResponse({ description: 'The vacancy is not published, or the application is live.' })
  public async submit(@Body() body: SubmitApplicationBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, SubmitApplicationCommand>({
        commandName: 'recruitment.submit-application',
        ...body,
      }),
    );
  }

  @Post(':applicationId/stage')
  @ApiOperation({ summary: 'Move the application through the pipeline' })
  public async move(
    @Param('applicationId') applicationId: string,
    @Body() body: MoveApplicationBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveApplicationCommand>({
        commandName: 'recruitment.move-application',
        applicationId,
        ...body,
      }),
    );
  }

  @Post(':applicationId/screening')
  @ApiOperation({ summary: 'Record a screening result. A result, not a status' })
  public async screen(
    @Param('applicationId') applicationId: string,
    @Body() body: RecordScreeningBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordScreeningCommand>({
        commandName: 'recruitment.record-screening',
        applicationId,
        ...body,
      }),
    );
  }

  @Post(':applicationId/closure')
  @ApiOperation({ summary: 'Reject with a reason, or record a withdrawal' })
  public async close(
    @Param('applicationId') applicationId: string,
    @Body() body: CloseApplicationBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CloseApplicationCommand>({
        commandName: 'recruitment.close-application',
        applicationId,
        ...body,
      }),
    );
  }
}
