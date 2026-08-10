import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ListResults,
  ReadDeductions,
  ReadEarnings,
  ReadPayslip,
} from '../application/result-queries.js';
import type {
  ReadAccountingOutput,
  ReadPaymentInstructions,
} from '../application/output-queries.js';

import { PayrollDispatcher } from './payroll-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Everything that carries money, each route behind its own permission.
 *
 * This is the separation that matters most in the module. `payroll.read` — which the run and period
 * routes use — sees that a run covered 1,400 people; **these** see what a named person was paid,
 * and require `payroll.read-result`. Collapsing them would make every payroll administrator a
 * reader of every salary in the company.
 *
 * The accounting and payment outputs are separate again, and from each other: a full payroll
 * accounting export is a full salary list by another name, and a payment file is the same list with
 * dates attached. Somebody who reconciles journals does not thereby need either.
 *
 * **Every amount leaves as an exact decimal string** with its currency code and exponent
 * (ADR-0061). Nothing on this path serializes a monetary value as a JSON number.
 */
@ApiTags('payroll')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'payroll', version: '1' })
export class PayrollResultController {
  public constructor(private readonly dispatcher: PayrollDispatcher) {}

  @Get('runs/:payrollRunId/results')
  @ApiOperation({ summary: "A run's results, one per employment and currency" })
  @ApiOkResponse({
    description: 'Paginated and bounded. Nothing is ever totalled across currencies.',
  })
  public async results(
    @Param('payrollRunId') payrollRunId: string,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListResults>({
        queryName: 'payroll.results',
        payrollRunId,
        ...paged(query),
      }),
    );
  }

  @Get('results/:payrollResultId/earnings')
  @ApiOperation({ summary: "A result's earning lines, each explaining itself" })
  public async earnings(@Param('payrollResultId') payrollResultId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadEarnings>({
        queryName: 'payroll.earnings',
        payrollResultId,
      }),
    );
  }

  @Get('results/:payrollResultId/deductions')
  @ApiOperation({ summary: "A result's deduction lines, in priority order" })
  public async deductions(@Param('payrollResultId') payrollResultId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDeductions>({
        queryName: 'payroll.deductions',
        payrollResultId,
      }),
    );
  }

  @Get('results/:payrollResultId/payslip')
  @ApiOperation({ summary: 'The payslip **data**, assembled from persisted rows alone' })
  @ApiOkResponse({
    description:
      'Payroll owns the data. Rendering, storage and delivery are NOT VERIFIED: no DocumentPort exists.',
  })
  public async payslip(@Param('payrollResultId') payrollResultId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadPayslip>({
        queryName: 'payroll.payslip',
        payrollResultId,
      }),
    );
  }

  @Get('runs/:payrollRunId/accounting-output')
  @ApiOperation({ summary: 'Balanced debit and credit lines for a finalized run' })
  @ApiOkResponse({
    description:
      'Prepared in Payroll’s own table. There is no Finance module and nothing is posted anywhere.',
  })
  public async accounting(
    @Param('payrollRunId') payrollRunId: string,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadAccountingOutput>({
        queryName: 'payroll.accounting-output',
        payrollRunId,
        ...paged(query),
      }),
    );
  }

  @Get('runs/:payrollRunId/payment-instructions')
  @ApiOperation({ summary: 'Payment instructions that nothing executes' })
  @ApiOkResponse({
    description:
      'No account number, no credential, and no state beyond prepared. Execution is NOT VERIFIED.',
  })
  public async payments(
    @Param('payrollRunId') payrollRunId: string,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadPaymentInstructions>({
        queryName: 'payroll.payment-instructions',
        payrollRunId,
        ...paged(query),
      }),
    );
  }
}
