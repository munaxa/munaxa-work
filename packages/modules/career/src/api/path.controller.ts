import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ReadCareerPath, SearchCareerPaths } from '../application/career-queries.js';
import type {
  AddCareerStageCommand,
  ArchiveCareerPathCommand,
  CreateCareerPathCommand,
  PublishCareerPathCommand,
} from '../application/path.use-case.js';
import type { CareerPathKind } from '../domain/career-vocabulary.js';

import { AddStageBody, CreatePathBody, VersionedBody } from './career.dto.js';
import { CareerDispatcher } from './career-dispatcher.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Career paths: the ladders a tenant defines, and the stages along them. Configuration.
 *
 * **A stage may name a position, and Career reads nothing else about it.** The identifier is
 * confirmed through Organization's exact-identifier lookup and then stored as a bare `position_id`.
 * No route here accepts a criticality, offers one as a filter, or returns one: enumerating a
 * tenant's critical positions is `NOT VERIFIED` (D-4), and nothing on this controller moves towards
 * it.
 *
 * Publication and archival are `POST`s to their own sub-resources rather than a status field, each
 * with its own rule — a path with no stages publishes nothing, because a ladder with no rungs
 * describes no career.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/paths', version: '1' })
export class CareerPathController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search paths. Bounded' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchCareerPaths>({
        queryName: 'career.search-paths',
        ...optional(query, ['status', 'kind', 'asOf']),
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a path. It starts in draft' })
  @ApiConflictResponse({ description: 'The code is already used in this tenant.' })
  public async create(@Body() body: CreatePathBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateCareerPathCommand>({
        commandName: 'career.create-path',
        code: body.code,
        name: body.name,
        kind: body.kind as CareerPathKind,
        effectiveFrom: body.effectiveFrom,
        ...present({ description: body.description, effectiveTo: body.effectiveTo }),
      }),
    );
  }

  @Get(':pathId')
  @ApiOperation({ summary: 'One path with its stages, in sequence' })
  public async read(
    @Param('pathId', ParseUUIDPipe) pathId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCareerPath>({
        queryName: 'career.read-path',
        pathId,
        ...optional(query, ['asOf']),
      }),
    );
  }

  @Post(':pathId/stages')
  @ApiOperation({ summary: 'Add a stage at a sequence. It may name a position; nothing else' })
  public async addStage(
    @Param('pathId', ParseUUIDPipe) pathId: string,
    @Body() body: AddStageBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AddCareerStageCommand>({
        commandName: 'career.add-stage',
        pathId,
        sequence: body.sequence,
        name: body.name,
        ...present({ targetPositionId: body.targetPositionId }),
      }),
    );
  }

  @Post(':pathId/publication')
  @ApiOperation({ summary: 'Publish a path. One with no stages publishes nothing' })
  public async publish(
    @Param('pathId', ParseUUIDPipe) pathId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishCareerPathCommand>({
        commandName: 'career.publish-path',
        pathId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':pathId/archive')
  @ApiOperation({ summary: 'Archive a path. Terminal, and not deletion' })
  public async archive(
    @Param('pathId', ParseUUIDPipe) pathId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ArchiveCareerPathCommand>({
        commandName: 'career.archive-path',
        pathId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
