import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { MAX_PERIOD_EMPLOYMENTS, type ReadPayrollPeriod } from '../application/payroll-query.js';
import type { ImportCompensationCommand } from '../application/import.use-case.js';
import type { ListImports } from '../application/definition-queries.js';
import type {
  ReadChangedSince,
  ReadCompensationDashboard,
} from '../application/reconciliation-query.js';

import { ImportBody } from './record.dto.js';
import { CompensationDispatcher } from './compensation-dispatcher.js';
import { employmentIds } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The Payroll contract, the reconciliation read, imports and the dashboard.
 *
 * **Every route here is a literal segment**, and this controller is declared before the ones
 * carrying parameterised segments at the same depth. Route ordering is load-bearing rather than
 * cosmetic: Nest resolves by declaration order, and a `:something` declared first would swallow
 * `payroll-period`.
 *
 * `payroll-period` is the Phase 11 contract: bounded, set-based, per-currency, and containing no
 * computed total, no interpreted treatment code and no conversion. `changed-since` is how Payroll
 * finds a retroactive correction — a **pull**, so its correctness never depends on an event having
 * been delivered.
 */
@ApiTags('compensation')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'compensation', version: '1' })
export class CompensationPayrollController {
  public constructor(private readonly dispatcher: CompensationDispatcher) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'The overview, including employments with no compensation at all' })
  public async dashboard(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCompensationDashboard>({
        queryName: 'compensation.dashboard',
      }),
    );
  }

  @Get('payroll-period')
  @ApiOperation({
    summary: 'What compensation applies to a page of employments over a period',
  })
  @ApiOkResponse({
    description:
      'Facts and flags. No gross, no net, no tax, no proration and no currency conversion.',
  })
  public async payrollPeriod(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadPayrollPeriod>({
        queryName: 'compensation.payroll-period',
        employmentIds: employmentIds(query['employmentIds'], MAX_PERIOD_EMPLOYMENTS),
        periodStart: query['from'] ?? '',
        periodEnd: query['to'] ?? '',
      }),
    );
  }

  @Get('changed-since')
  @ApiOperation({ summary: 'What has been recorded since a caller last looked. System time' })
  public async changedSince(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadChangedSince>({
        queryName: 'compensation.changed-since',
        recordedAfter: new Date(query['recordedAfter'] ?? 0),
        from: query['from'] ?? '',
        to: query['to'] ?? '',
      }),
    );
  }

  @Get('imports')
  @ApiOperation({ summary: 'What each batch covered, wrote, skipped and failed' })
  public async imports(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListImports>({ queryName: 'compensation.imports' }),
    );
  }

  @Post('imports')
  @ApiOperation({
    summary: 'A bounded, idempotent bulk load. Validated by the same rules as a manual write',
  })
  public async import(@Body() body: ImportBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ImportCompensationCommand>({
        commandName: 'compensation.import',
        ...body,
      }),
    );
  }
}
