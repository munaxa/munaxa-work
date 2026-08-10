import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  ReadBalanceAsOf,
  ReadBalances,
  ReadLedger,
  ReadProjectedBalance,
} from '../application/balance-queries.js';
import type { BalancesAwaitingRecalculation } from '../application/reconciliation-query.js';
import type { RecalculateBalancesCommand } from '../application/recalculate.use-case.js';

import { LeaveDispatcher } from './leave-dispatcher.js';
import { balanceFilters, ledgerFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Balances, the ledger behind them, and the reconciliation that keeps them honest.
 *
 * **Route ordering is load-bearing here**, and Phase 8 proved it: `reconciliation` is a literal
 * segment that would otherwise be captured by `:employmentId`, so it is declared first — and an API
 * test asserts the resolution rather than trusting the declaration order.
 *
 * The three balance reads are three genuinely different questions. The projection row answers
 * "now"; the as-of read **re-derives the figure from the ledger independently**, which is what makes
 * a wrong projection detectable; and the projected read adds the accrual the policy will produce
 * before the year end, marked on the contract as a projection that assumes continued employment.
 */
@ApiTags('leave')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'leave/balances', version: '1' })
export class LeaveBalanceController {
  public constructor(private readonly dispatcher: LeaveDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Balances, paged and filterable' })
  @ApiOkResponse({ description: 'A page of balance projections.' })
  public async list(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadBalances>({
        queryName: 'leave.balances',
        ...balanceFilters(query),
        ...paging(query),
      }),
    );
  }

  /** Declared before `:employmentId`, or the literal would be captured as an identifier. */
  @Get('reconciliation')
  @ApiOperation({ summary: 'Balances whose ledger moved after they were last calculated' })
  @ApiOkResponse({ description: 'The number that grows when something is quietly not working.' })
  public async reconciliation(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, BalancesAwaitingRecalculation>({
        queryName: 'leave.balances-awaiting-recalculation',
        ...(query['limit'] === undefined ? {} : { limit: Number(query['limit']) }),
      }),
    );
  }

  @Get('ledger')
  @ApiOperation({ summary: 'The movements behind a balance — why it is this number' })
  public async ledger(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadLedger>({
        queryName: 'leave.ledger',
        ...ledgerFilters(query),
        ...paging(query),
      }),
    );
  }

  @Get(':employmentId/as-of')
  @ApiOperation({ summary: 'The balance on a past date, summed from the ledger independently' })
  public async asOf(
    @Param('employmentId') employmentId: string,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadBalanceAsOf>({
        queryName: 'leave.balance-as-of',
        employmentId,
        leaveTypeId: query['leaveTypeId'] ?? '',
        onDate: query['date'] ?? '',
      }),
    );
  }

  @Get(':employmentId/projected')
  @ApiOperation({ summary: 'The year-end balance, assuming continued employment and policy' })
  public async projected(
    @Param('employmentId') employmentId: string,
    @Query() query: Record<string, string>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadProjectedBalance>({
        queryName: 'leave.projected-balance',
        employmentId,
        leaveTypeId: query['leaveTypeId'] ?? '',
        onDate: query['date'] ?? '',
      }),
    );
  }

  @Post('recalculation')
  @ApiOperation({ summary: 'Recompute what is marked stale. Idempotent and bounded' })
  public async recalculate(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecalculateBalancesCommand>({
        commandName: 'leave.recalculate-balances',
        ...(query['limit'] === undefined ? {} : { limit: Number(query['limit']) }),
      }),
    );
  }
}
