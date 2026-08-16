import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  DecidedApprovals,
  PendingApprovals,
  ReadApprovalStatus,
} from '../application/approval-queries.js';
import type { DecideStepCommand } from '../application/decision.use-case.js';

import { DecideStepBody } from './workflow.dto.js';
import { WorkflowDispatcher } from './workflow-dispatcher.js';
import { paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The approver's own surface: what is waiting for them, what they decided, and answering a step.
 *
 * **Nothing on this controller takes an identity, and that is its most important property.** The two
 * queues are resolved from the membership the authenticated request carries — the seam Checkpoint 4
 * added — and there is no path parameter, no query parameter and no body field through which a
 * caller could name a membership, a workforce user, a platform user or an approver. A queue endpoint
 * that accepted an identifier would let anybody holding the permission read anybody's queue, which
 * is why `forbidNonWhitelisted` refuses an undeclared property rather than dropping it.
 *
 * These routes are `pending` and `decided` rather than `me` deliberately. `/me` implies a self
 * resolved from an identity the platform can supply, and everywhere else in this repository that
 * resolution does not exist (ADR-0032); here the caller is not a *self* but a **membership**, and
 * the route says what it returns rather than who it is for.
 *
 * **Delegation is decided inside the handler and never here.** Whether the caller is acting for
 * somebody else is Identity's answer, asked at the instant of the decision through Workflow's
 * delegation port. This controller neither asks nor accepts `onBehalfOf`, and a delegated decision
 * records two memberships — the delegate who acted, the approver whose authority was used — without
 * either arriving on the wire.
 *
 * **A terminal decision reaches the module that raised the approval inside this request**, through
 * the application's own seam. There is no route here for that, and none anywhere in the module: if
 * the owning module refuses, this endpoint refuses, and nothing is recorded on either side.
 */
@ApiTags('workflow')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'workflow/approvals', version: '1' })
export class WorkflowApprovalController {
  public constructor(private readonly dispatcher: WorkflowDispatcher) {}

  @Get('pending')
  @ApiOperation({ summary: 'The steps waiting on the caller. Resolved from the request' })
  @ApiOkResponse({
    description: 'Empty when the request resolved no membership. Never everybody’s.',
  })
  public async pending(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, PendingApprovals>({
        queryName: 'workflow.pending-approvals',
        ...paged(query),
      }),
    );
  }

  @Get('decided')
  @ApiOperation({ summary: 'What the caller decided. A delegated decision is the delegate’s' })
  public async decided(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, DecidedApprovals>({
        queryName: 'workflow.decided-approvals',
        ...paged(query),
      }),
    );
  }

  @Get(':instanceId/status')
  @ApiOperation({ summary: 'An approval in the port’s vocabulary: state and the chain so far' })
  public async status(@Param('instanceId', ParseUUIDPipe) instanceId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadApprovalStatus>({
        queryName: 'workflow.read-approval-status',
        approvalId: instanceId,
      }),
    );
  }

  @Post(':instanceId/decision')
  @ApiOperation({ summary: 'Answer the step you were asked to answer, or one delegated to you' })
  @ApiConflictResponse({ description: 'The approval changed since it was read.' })
  @ApiUnprocessableEntityResponse({
    description: 'The step is not yours, is not awaiting a decision, or the subject refused it.',
  })
  public async decide(
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Body() body: DecideStepBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DecideStepCommand>({
        commandName: 'workflow.decide-step',
        instanceId,
        decision: body.decision,
        expectedVersion: body.expectedVersion,
        // `stepId` narrows the caller's own open steps and cannot widen them: the handler resolves
        // what is theirs from the membership on the request first, and filters by this afterwards.
        ...present({ comment: body.comment, stepId: body.stepId }),
      }),
    );
  }
}
