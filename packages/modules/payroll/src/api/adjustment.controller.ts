import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { RecordAdjustmentCommand } from '../application/adjustment.use-case.js';
import type { ListAdjustmentReasons, ListAdjustments } from '../application/run-queries.js';

import { AdjustmentBody } from './payroll.dto.js';
import { PayrollDispatcher } from './payroll-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Adjusting a run, and reading its adjustments.
 *
 * Apart from the other decisions only to keep each controller inside the file budget. The figures and
 * the reasons behind them stay separate reads: `payroll.adjust` may read the sentence somebody wrote
 * about why a figure changed, and reading a figure is not reading the reason behind it.
 */
@ApiTags('payroll')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'payroll/runs', version: '1' })
export class PayrollAdjustmentController {
  public constructor(private readonly dispatcher: PayrollDispatcher) {}

  @Get(':payrollRunId/adjustments')
  @ApiOperation({ summary: 'The adjustments on a run, without their reasons' })
  public async adjustments(
    @Param('payrollRunId', ParseUUIDPipe) payrollRunId: string,
  ): Promise<unknown> {
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
  public async adjustmentReasons(
    @Param('payrollRunId', ParseUUIDPipe) payrollRunId: string,
  ): Promise<unknown> {
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
