import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AddPathStepCommand,
  ArchivePathCommand,
  CreatePathCommand,
  PublishPathCommand,
  RemovePathStepCommand,
} from '../application/path.use-case.js';
import type { ListPaths, ReadPath } from '../application/learning-queries.js';
import type { PathKind } from '../domain/learning-vocabulary.js';

import { AddPathStepBody, CreatePathBody, VersionedBody } from './learning.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Learning paths: an ordered set of courses a tenant groups together.
 *
 * **A step's sequence is an order, not a gate.** No route here enforces a prerequisite, because
 * prerequisites were never specified — and enforcing an unspecified one would block real people
 * from real training on a rule nobody wrote.
 *
 * **Removing a step changes what the path asks for from now on and rewrites nothing.** Assignments
 * already generated from it stay exactly as they are: what somebody was asked to do in March is a
 * historical fact, and the compliance trail this module exists to keep depends on it.
 *
 * Publication and archival are `POST`s to their own sub-resources rather than a status field: each
 * has its own rule — a path with nothing in it publishes nothing, because anybody could satisfy it
 * by doing nothing at all.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/paths', version: '1' })
export class LearningPathController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'List paths. Bounded' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListPaths>({
        queryName: 'learning.list-paths',
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a path. It starts in draft' })
  @ApiConflictResponse({ description: 'The code is already used in this tenant.' })
  public async create(@Body() body: CreatePathBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreatePathCommand>({
        commandName: 'learning.create-path',
        code: body.code,
        name: body.name,
        kind: body.kind as PathKind,
        ...present({ description: body.description }),
      }),
    );
  }

  @Get(':pathId')
  @ApiOperation({ summary: 'One path with its steps, in sequence' })
  public async read(@Param('pathId') pathId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadPath>({ queryName: 'learning.read-path', pathId }),
    );
  }

  @Post(':pathId/steps')
  @ApiOperation({ summary: 'Add a course to a path at a sequence' })
  public async addStep(
    @Param('pathId') pathId: string,
    @Body() body: AddPathStepBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AddPathStepCommand>({
        commandName: 'learning.add-path-step',
        pathId,
        courseId: body.courseId,
        sequence: body.sequence,
        optional: body.optional,
      }),
    );
  }

  @Delete(':pathId/steps/:stepId')
  @ApiOperation({ summary: 'Take a course back out. Assignments already generated are untouched' })
  public async removeStep(
    @Param('pathId') pathId: string,
    @Param('stepId') stepId: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RemovePathStepCommand>({
        commandName: 'learning.remove-path-step',
        pathId,
        stepId,
      }),
    );
  }

  @Post(':pathId/publication')
  @ApiOperation({ summary: 'Publish a path. An empty one publishes nothing' })
  public async publish(
    @Param('pathId') pathId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishPathCommand>({
        commandName: 'learning.publish-path',
        pathId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':pathId/archive')
  @ApiOperation({ summary: 'Archive a path. Terminal, and not deletion' })
  public async archive(
    @Param('pathId') pathId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ArchivePathCommand>({
        commandName: 'learning.archive-path',
        pathId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
