import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type { DecideLeaveRequestCommand } from '../application/decision.use-case.js';
import type { CancelLeaveRequestCommand } from '../application/cancellation.use-case.js';
import type { ReadApprovalChain } from '../application/request-queries.js';

import { CancelBody, DecideBody } from './leave.dto.js';
import { LeaveDispatcher } from './leave-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Deciding a request, and unmaking one.
 *
 * **No body names the decider.** `decidedBy` comes from the authenticated context, and the database
 * refuses a decision row whose `decided_by` equals its `requested_by` — a comparison that is only
 * meaningful because neither value came from the wire. Self-approval is refused by the domain, by
 * the permission separation, and by a check constraint; a control that lives in one layer is a
 * control any future path around that layer silently removes.
 *
 * **The approval chain is published from this phase**, in `ApprovalPort`'s own shape — but sourced
 * from Leave's decision table rather than from `ApprovalPort`, because the only adapter in this
 * repository approves everything automatically as `system:auto-approval` and treating that as a
 * human decision about paid absence would be recording something that did not happen (ADR-0045).
 * When Phase 16 lands, the source changes and this contract does not.
 *
 * **Cancellation reverses; it never deletes.** The original consumption stays and a reversal is
 * written beside it, because "consumed and then given back" and "never consumed" are different
 * facts about somebody's year.
 */
@ApiTags('leave')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@ApiUnprocessableEntityResponse({ description: 'A well-formed request the domain refused.' })
@Controller({ path: 'leave/requests', version: '1' })
export class LeaveDecisionController {
  public constructor(private readonly dispatcher: LeaveDispatcher) {}

  @Get(':leaveRequestId/approval-chain')
  @ApiOperation({
    summary: "The chain, in ApprovalPort's shape. No steps where none were required",
  })
  @ApiOkResponse({
    description: 'The decisions made, or an empty chain where the policy required no approval.',
  })
  public async chain(@Param('leaveRequestId') leaveRequestId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadApprovalChain>({
        queryName: 'leave.approval-chain',
        leaveRequestId,
      }),
    );
  }

  @Post(':leaveRequestId/decision')
  @ApiOperation({ summary: 'Decide. The decider comes from the context, never from the body' })
  public async decide(
    @Param('leaveRequestId') leaveRequestId: string,
    @Body() body: DecideBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DecideLeaveRequestCommand>({
        commandName: 'leave.decide-request',
        leaveRequestId,
        ...body,
      } as DecideLeaveRequestCommand),
    );
  }

  @Post(':leaveRequestId/cancellation')
  @ApiOperation({ summary: 'Unmake an approved request. Writes a reversal, never a deletion' })
  public async cancel(
    @Param('leaveRequestId') leaveRequestId: string,
    @Body() body: CancelBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CancelLeaveRequestCommand>({
        commandName: 'leave.cancel-request',
        leaveRequestId,
        ...body,
      }),
    );
  }
}
