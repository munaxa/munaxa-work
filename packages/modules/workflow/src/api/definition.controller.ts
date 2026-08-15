import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ReadDefinition, SearchDefinitions } from '../application/workflow-queries.js';
import type {
  CreateDefinitionCommand,
  DraftVersionCommand,
  RetireDefinitionCommand,
} from '../application/definition.use-case.js';

import { CreateDefinitionBody, VersionedBody } from './workflow.dto.js';
import { WorkflowDispatcher } from './workflow-dispatcher.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Workflow definitions: the processes a tenant configured, and the versions of them. Configuration.
 *
 * **A definition names what it decides, never what it decides about.** `subjectType` is the opaque
 * string a business module supplies — `recruitment.requisition` — and this controller neither holds
 * a list of legal values nor offers one as an enumeration. A list here would be a list of business
 * modules, and Workflow is required to know about none of them (AD-001).
 *
 * Retirement is a `POST` to its own sub-resource rather than a status field, and it stops nothing
 * that is already running: an instance copies its steps when it starts, so retiring the definition
 * pulls nothing out from under an approval half-way through (AD-003).
 *
 * Drafting a version is a `POST` to the definition's `versions` collection because a version belongs
 * to a definition and its number is derived rather than supplied — the caller cannot name it, and
 * there is no route through which they could.
 */
@ApiTags('workflow')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'workflow/definitions', version: '1' })
export class WorkflowDefinitionController {
  public constructor(private readonly dispatcher: WorkflowDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search definitions. Bounded' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchDefinitions>({
        queryName: 'workflow.search-definitions',
        ...optional(query, ['status', 'subjectType']),
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a process. It starts active with no version' })
  @ApiConflictResponse({ description: 'The code is already used in this tenant.' })
  public async create(@Body() body: CreateDefinitionBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateDefinitionCommand>({
        commandName: 'workflow.create-definition',
        code: body.code,
        name: body.name,
        subjectType: body.subjectType,
        ...present({ description: body.description }),
      }),
    );
  }

  @Get(':definitionId')
  @ApiOperation({ summary: 'One definition with a page of its versions' })
  public async read(
    @Param('definitionId', ParseUUIDPipe) definitionId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDefinition>({
        queryName: 'workflow.read-definition',
        definitionId,
        ...paged(query),
      }),
    );
  }

  @Post(':definitionId/retirement')
  @ApiOperation({ summary: 'Retire a definition. Terminal, and it stops nothing already running' })
  @ApiConflictResponse({ description: 'The definition changed since it was read.' })
  public async retire(
    @Param('definitionId', ParseUUIDPipe) definitionId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RetireDefinitionCommand>({
        commandName: 'workflow.retire-definition',
        definitionId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':definitionId/versions')
  @ApiOperation({ summary: 'Draft the next version. Its number is derived, never supplied' })
  public async draft(@Param('definitionId', ParseUUIDPipe) definitionId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DraftVersionCommand>({
        commandName: 'workflow.draft-version',
        definitionId,
      }),
    );
  }
}
