import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ListTalentPools } from '../application/career-queries.js';
import type {
  AddToTalentPoolCommand,
  CloseTalentPoolCommand,
  CreateTalentPoolCommand,
} from '../application/pool.use-case.js';
import type { TalentPoolKind } from '../domain/career-vocabulary.js';

import { AddToPoolBody, CreatePoolBody, VersionedBody } from './career.dto.js';
import { CareerDispatcher } from './career-dispatcher.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Talent pools: the groups a tenant maintains, and who an organization decided belongs in one.
 *
 * **Creating a pool and putting somebody in it are different permissions**, and the routes here are
 * split along that seam. `career.pool.manage` is configuration — a "high potential" pool is a
 * container. `career.pool.assign` is a judgement recorded about a named person, and it is not
 * implied by `manage`.
 *
 * **A pool membership is a decision, not an observation** (ADR-0073). Nothing here reads a nine-box
 * placement, a potential band or a performance rating, and no route offers one as a filter: those
 * are Performance's observations of one cycle, and deriving one from the other would put a number
 * nobody agreed on beside a person's name. Performance integration is `NOT VERIFIED` (D-5).
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/pools', version: '1' })
export class CareerPoolController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'List pools. Bounded' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListTalentPools>({
        queryName: 'career.list-pools',
        ...optional(query, ['status']),
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a pool. Configuration, and nobody is in it yet' })
  @ApiConflictResponse({ description: 'The code is already used in this tenant.' })
  public async create(@Body() body: CreatePoolBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateTalentPoolCommand>({
        commandName: 'career.create-pool',
        code: body.code,
        name: body.name,
        kind: body.kind as TalentPoolKind,
        ...present({ description: body.description }),
      }),
    );
  }

  @Post(':talentPoolId/closure')
  @ApiOperation({ summary: 'Close a pool. Who was in it stays readable' })
  public async close(
    @Param('talentPoolId', ParseUUIDPipe) talentPoolId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CloseTalentPoolCommand>({
        commandName: 'career.close-pool',
        talentPoolId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':talentPoolId/memberships')
  @ApiOperation({ summary: 'Put somebody in a pool. A judgement about them, not configuration' })
  public async add(
    @Param('talentPoolId', ParseUUIDPipe) talentPoolId: string,
    @Body() body: AddToPoolBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AddToTalentPoolCommand>({
        commandName: 'career.add-to-pool',
        talentPoolId,
        employmentId: body.employmentId,
        from: body.from,
        ...present({ reason: body.reason }),
      }),
    );
  }
}
