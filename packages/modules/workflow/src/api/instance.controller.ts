import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ReadInstance, SearchInstances } from '../application/workflow-queries.js';
import type { ReadHistory } from '../application/approval-queries.js';
import type {
  CancelInstanceCommand,
  StartInstanceCommand,
} from '../application/instance.use-case.js';

import { CancelInstanceBody, StartInstanceBody } from './workflow-approval.dto.js';
import { WorkflowDispatcher } from './workflow-dispatcher.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Running approvals: raising one, reading one, stopping one, and reading how it got where it is.
 *
 * **Starting an approval converges rather than duplicating.** A second request for a subject that
 * already has one running returns the approval that exists, with `created: false`, because two
 * clicks on a submit button should not put two chains in front of two directors.
 *
 * **Cancellation is its own sub-resource and its own permission.** Stopping an approval nobody
 * decided is a different act from raising one, and `instance.cancel` is not implied by
 * `instance.start`: the person who raised a request is not thereby the person who may end somebody
 * else's without a decision.
 *
 * **The requester is the membership on the request.** No body below names one, so there is no route
 * through which a caller could raise an approval in somebody else's name.
 *
 * **There is no route that sets an instance's status.** An approval reaches `completed`, `rejected`
 * or `cancelled` by being decided or by being cancelled, and a generic status endpoint would let a
 * caller assign a terminal state without anybody deciding anything — which is the whole failure this
 * module exists to prevent.
 */
@ApiTags('workflow')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'workflow/instances', version: '1' })
export class WorkflowInstanceController {
  public constructor(private readonly dispatcher: WorkflowDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search approvals across the tenant. Bounded' })
  @ApiOkResponse({ description: 'An administrator’s view, not an approver’s queue.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchInstances>({
        queryName: 'workflow.search-instances',
        ...optional(query, ['status', 'definitionId', 'subjectType', 'subjectId']),
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Raise an approval. A subject already awaiting one converges on it' })
  public async start(@Body() body: StartInstanceBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, StartInstanceCommand>({
        commandName: 'workflow.start-instance',
        definitionId: body.definitionId,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        ...present({ context: body.context }),
      }),
    );
  }

  @Get(':instanceId')
  @ApiOperation({ summary: 'One approval with its steps, in order' })
  public async read(@Param('instanceId', ParseUUIDPipe) instanceId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadInstance>({
        queryName: 'workflow.read-instance',
        instanceId,
      }),
    );
  }

  @Get(':instanceId/history')
  @ApiOperation({ summary: 'How this approval got here, oldest first. Bounded' })
  @ApiOkResponse({ description: 'Routing events only. No comment and no rationale.' })
  public async history(
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadHistory>({
        queryName: 'workflow.read-history',
        instanceId,
        ...paged(query),
      }),
    );
  }

  @Post(':instanceId/cancellation')
  @ApiOperation({ summary: 'Stop an approval nobody decided. A reason is required' })
  @ApiConflictResponse({ description: 'The approval changed since it was read.' })
  public async cancel(
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Body() body: CancelInstanceBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CancelInstanceCommand>({
        commandName: 'workflow.cancel-instance',
        instanceId,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
