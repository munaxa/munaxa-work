import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ConcludeInvestigationCommand,
  OpenInvestigationCommand,
} from '../application/investigation.use-case.js';
import type {
  ListInvestigations,
  ReadCaseHistory,
  ReadInvestigation,
} from '../application/relations-queries.js';

import { ConcludeInvestigationBody, OpenInvestigationBody } from './relations.dto.js';
import { RelationsDispatcher } from './relations-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Investigations, and the case history they move.
 *
 * **Two writes, and neither is a state field.** There is no `PATCH /state`, no route that sets where
 * a case is, and no body carrying a `from` state. A case moves because somebody opened or concluded
 * an inquiry, and the transition is that act's consequence — which is why the history can be read
 * back as a sequence of things people did rather than a column somebody set.
 *
 * **The case history is read-only, everywhere.** No route writes to it and no route amends it: the
 * database refuses both unconditionally, and there is no application method that could try.
 *
 * **Every route that returns an investigation or a history writes an access event** (AD-007), inside
 * the read's own transaction — so a read whose trail could not be written returns nothing.
 */
@ApiTags('relations')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'relations/investigations', version: '1' })
export class InvestigationController {
  public constructor(private readonly dispatcher: RelationsDispatcher) {}

  @Get()
  @ApiOperation({ summary: "One violation's inquiries, newest first" })
  @ApiOkResponse({ description: 'Each investigation disclosed is recorded in the access trail.' })
  public async investigations(
    @Query('violationId') violationId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListInvestigations>({
        queryName: 'relations.investigations',
        violationId,
        ...(page === undefined ? {} : { page: Number(page) }),
        ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Open an inquiry into a recorded violation' })
  public async open(@Body() body: OpenInvestigationBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, OpenInvestigationCommand>({
        commandName: 'relations.open-investigation',
        ...body,
      }),
    );
  }

  @Get(':investigationId')
  @ApiOperation({ summary: 'One inquiry. Reading it is recorded against your name' })
  public async investigation(@Param('investigationId') investigationId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadInvestigation>({
        queryName: 'relations.read-investigation',
        investigationId,
      }),
    );
  }

  /**
   * Concluding is a `POST` to a named act rather than a `PATCH` of a state field, deliberately: the
   * request is *"this inquiry has concluded, and here is what it found"*, not *"set this row's state
   * to concluded"*. The second shape would invite a caller to set any state they liked.
   */
  @Post(':investigationId/conclusion')
  @ApiOperation({ summary: 'Conclude an inquiry with findings and a recommendation' })
  public async conclude(
    @Param('investigationId') investigationId: string,
    @Body() body: ConcludeInvestigationBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ConcludeInvestigationCommand>({
        commandName: 'relations.conclude-investigation',
        investigationId,
        ...body,
      }),
    );
  }
}

/**
 * A case's current state and every transition behind it.
 *
 * Its own controller because its path is the *violation's*, not an investigation's: a case is
 * identified by the matter it concerns, and the inquiries are things that happened to it.
 */
@ApiTags('relations')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'relations/cases', version: '1' })
export class CaseHistoryController {
  public constructor(private readonly dispatcher: RelationsDispatcher) {}

  @Get(':violationId/history')
  @ApiOperation({ summary: 'Where a case is, and every transition that got it there' })
  @ApiOkResponse({ description: 'The current state is derived from the history, not stored.' })
  public async history(@Param('violationId') violationId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCaseHistory>({
        queryName: 'relations.case-history',
        violationId,
      }),
    );
  }
}
