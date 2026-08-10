import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { CalculateRunCommand } from '../application/calculation-contract.js';
import type { ReconcileRunCommand } from '../application/reconciliation.use-case.js';
import type {
  ListExceptions,
  ListRuns,
  ReadReconciliation,
  ReadRun,
} from '../application/run-queries.js';

import { CalculateBody } from './payroll.dto.js';
import { PayrollDispatcher } from './payroll-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The run's whole lifecycle: calculate, reconcile, approve, finalize, reverse and adjust.
 *
 * **No business rule lives here.** Each route resolves the identifier, forwards a command and maps
 * the failure; the refusals a caller sees — `run_finalized`, `run_has_unresolved_exceptions`,
 * `self_approval_not_permitted` — come from the domain, so the API and the in-process caller cannot
 * disagree about what is permitted.
 *
 * Calculation is **driven by repeated calls** rather than one request that holds a connection for
 * forty minutes: `maxBatches` bounds an invocation and the response's `complete` flag says whether
 * another is needed.
 */
@ApiTags('payroll')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'payroll/runs', version: '1' })
export class PayrollRunController {
  public constructor(private readonly dispatcher: PayrollDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The payroll runs, most recent first' })
  public async runs(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListRuns>({ queryName: 'payroll.runs', ...paged(query) }),
    );
  }

  @Post('calculation')
  @ApiOperation({ summary: 'Calculate a payroll period, in bounded resumable batches' })
  @ApiOkResponse({
    description:
      '`complete: false` means the population is not covered yet and another call is required.',
  })
  public async calculate(@Body() body: CalculateBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CalculateRunCommand>({
        commandName: 'payroll.calculate',
        ...body,
      }),
    );
  }

  @Get(':payrollRunId')
  @ApiOperation({ summary: 'One run, and everything it was calculated under' })
  public async run(@Param('payrollRunId') payrollRunId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadRun>({ queryName: 'payroll.run', payrollRunId }),
    );
  }

  @Get(':payrollRunId/exceptions')
  @ApiOperation({ summary: 'Why an employment was not calculated' })
  @ApiOkResponse({
    description: 'A real answer per employment. Never a silent skip and never a result of zero.',
  })
  public async exceptions(@Param('payrollRunId') payrollRunId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListExceptions>({
        queryName: 'payroll.exceptions',
        payrollRunId,
      }),
    );
  }

  @Post(':payrollRunId/reconciliation')
  @ApiOperation({ summary: 'Ask every source whether it has moved since this run was calculated' })
  @ApiOkResponse({
    description: 'A pull. Correctness never depends on an event having been delivered.',
  })
  public async reconcile(@Param('payrollRunId') payrollRunId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReconcileRunCommand>({
        commandName: 'payroll.reconcile',
        payrollRunId,
      }),
    );
  }

  @Get(':payrollRunId/reconciliation')
  @ApiOperation({ summary: 'What reconciliation found. Nothing here repaired anything' })
  public async reconciliation(@Param('payrollRunId') payrollRunId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadReconciliation>({
        queryName: 'payroll.reconciliation',
        payrollRunId,
      }),
    );
  }
}
