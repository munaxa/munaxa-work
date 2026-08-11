import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { RecordAdjustmentCommand } from '../application/adjustment.use-case.js';
import type {
  DecideCompensationCommand,
  ReverseDecisionCommand,
} from '../application/decision.use-case.js';
import type { ReadApprovalChain, SearchAdjustments } from '../application/compensation-queries.js';

import { DecisionBody, RecordAdjustmentBody, ReverseDecisionBody } from './record.dto.js';
import { CompensationDispatcher } from './compensation-dispatcher.js';
import { adjustmentFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Adjustments and approvals — the two things a human does that no rule produced.
 *
 * **Adjustments sit behind `compensation.adjust`**, not `compensation.read`: the note on one is the
 * sentence somebody wrote about *why* a person's pay changed, and that is a narrower disclosure
 * than the figure itself.
 *
 * **Deciding sits behind `compensation.approve`**, never the same permission as managing. The
 * domain refuses self-approval even for somebody holding both, and so does a check constraint.
 *
 * A wrong decision is corrected by a **reversal** — a `POST`, not a `DELETE` and not a `PATCH`.
 * Both rows stay in the chain, because an approval chain that could be edited is not a record of
 * who decided what.
 */
@ApiTags('compensation')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'compensation', version: '1' })
export class CompensationApprovalController {
  public constructor(private readonly dispatcher: CompensationDispatcher) {}

  @Get('adjustments')
  @ApiOperation({ summary: 'Every manual change, with its actor and its written reason' })
  @ApiOkResponse({ description: 'Reasons and notes require compensation.adjust.' })
  public async adjustments(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchAdjustments>({
        queryName: 'compensation.adjustments',
        ...adjustmentFilters(query),
        ...paging(query),
      }),
    );
  }

  @Post('adjustments')
  @ApiOperation({
    summary: 'Record an adjustment and the change it explains, in one transaction',
  })
  public async adjust(@Body() body: RecordAdjustmentBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordAdjustmentCommand>({
        commandName: 'compensation.record-adjustment',
        ...body,
      }),
    );
  }

  @Get('approvals/:subjectKind/:subjectId')
  @ApiOperation({ summary: 'The approval chain, in the shape Phase 16 will keep' })
  public async chain(
    @Param('subjectKind') subjectKind: string,
    @Param('subjectId') subjectId: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadApprovalChain>({
        queryName: 'compensation.approval-chain',
        subjectKind,
        subjectId,
      }),
    );
  }

  @Post('approvals/decision')
  @ApiOperation({ summary: 'Decide. A named human, never a system approver' })
  public async decide(@Body() body: DecisionBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DecideCompensationCommand>({
        commandName: 'compensation.decide',
        ...body,
      }),
    );
  }

  @Post('approvals/decision-reversal')
  @ApiOperation({
    summary: 'Reverse a decision. Permitted while the change is still future-dated',
  })
  public async reverse(@Body() body: ReverseDecisionBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReverseDecisionCommand>({
        commandName: 'compensation.reverse-decision',
        ...body,
      }),
    );
  }
}
