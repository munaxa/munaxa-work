import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ApproveRunCommand,
  ReverseApprovalCommand,
} from '../application/decision.use-case.js';
import type {
  FinalizeRunCommand,
  ReverseRunCommand,
} from '../application/finalization.use-case.js';
import type { RecordAdjustmentCommand } from '../application/adjustment.use-case.js';
import type {
  ListAdjustmentReasons,
  ListAdjustments,
  ReadApprovalChain,
} from '../application/run-queries.js';

import { AdjustmentBody, DecisionBody, ReversalBody } from './payroll.dto.js';
import { PayrollDispatcher } from './payroll-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The decisions somebody makes about a run: approve, reverse an approval, finalize, reverse, adjust.
 *
 * Four permissions, deliberately separate. `payroll.approve` accepts responsibility for what a
 * workforce is about to be paid; `payroll.finalize` is the stronger one that makes it immutable;
 * `payroll.reverse` undoes a finalized run into new state; `payroll.adjust` may read the sentence
 * somebody wrote about why a figure changed. Each is enforced by the handler's own declaration, not
 * by a guard on this class.
 */
@ApiTags('payroll')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'payroll/runs', version: '1' })
export class PayrollDecisionController {
  public constructor(private readonly dispatcher: PayrollDispatcher) {}

  @Get(':payrollRunId/approval-chain')
  @ApiOperation({ summary: 'Who decided what, and what was reversed' })
  public async approvalChain(@Param('payrollRunId') payrollRunId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadApprovalChain>({
        queryName: 'payroll.approval-chain',
        payrollRunId,
      }),
    );
  }

  @Post(':payrollRunId/approval')
  @ApiOperation({ summary: 'Approve a run, as the authenticated human' })
  @ApiOkResponse({
    description:
      'The approver comes from the authenticated context. Self-approval and a stale run are refused.',
  })
  public async approve(
    @Param('payrollRunId') payrollRunId: string,
    @Body() body: DecisionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ApproveRunCommand>({
        commandName: 'payroll.approve',
        payrollRunId,
        ...body,
      }),
    );
  }

  @Post('approvals/:approvalDecisionId/reversal')
  @ApiOperation({ summary: 'Reverse an approval without erasing it' })
  public async reverseApproval(
    @Param('approvalDecisionId') approvalDecisionId: string,
    @Body() body: DecisionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReverseApprovalCommand>({
        commandName: 'payroll.reverse-approval',
        approvalDecisionId,
        ...body,
      }),
    );
  }

  @Post(':payrollRunId/finalization')
  @ApiOperation({ summary: 'Freeze the run and generate its accounting and payment outputs' })
  @ApiOkResponse({
    description:
      'Prepared, not posted and not executed. After this no update path can change a figure.',
  })
  public async finalize(@Param('payrollRunId') payrollRunId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, FinalizeRunCommand>({
        commandName: 'payroll.finalize',
        payrollRunId,
      }),
    );
  }

  @Post(':payrollRunId/reversal')
  @ApiOperation({ summary: 'Reverse a finalized run into a new run, preserving the original' })
  public async reverse(
    @Param('payrollRunId') payrollRunId: string,
    @Body() body: ReversalBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReverseRunCommand>({
        commandName: 'payroll.reverse-run',
        payrollRunId,
        ...body,
      }),
    );
  }

  @Get(':payrollRunId/adjustments')
  @ApiOperation({ summary: 'The adjustments on a run, without their reasons' })
  public async adjustments(@Param('payrollRunId') payrollRunId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListAdjustments>({
        queryName: 'payroll.adjustments',
        payrollRunId,
      }),
    );
  }

  @Get(':payrollRunId/adjustment-reasons')
  @ApiOperation({ summary: 'The same adjustments **with** their reasons' })
  @ApiOkResponse({
    description: 'Behind `payroll.adjust`: reading a figure is not reading the reason behind it.',
  })
  public async adjustmentReasons(@Param('payrollRunId') payrollRunId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListAdjustmentReasons>({
        queryName: 'payroll.adjustment-reasons',
        payrollRunId,
      }),
    );
  }

  @Post('adjustments')
  @ApiOperation({ summary: 'Record an adjustment, with the sentence explaining why' })
  public async adjust(@Body() body: AdjustmentBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordAdjustmentCommand>({
        commandName: 'payroll.record-adjustment',
        ...body,
      }),
    );
  }
}
