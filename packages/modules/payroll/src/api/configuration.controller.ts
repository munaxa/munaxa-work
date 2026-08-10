import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  DefineDeductionCommand,
  DefinePayrollGroupCommand,
} from '../application/group.use-case.js';
import type {
  MovePeriodCommand,
  OpenPayrollPeriodCommand,
} from '../application/period.use-case.js';
import type {
  ListDeductions,
  ListPayrollGroups,
  ListPeriods,
  ReadPayrollDashboard,
} from '../application/definition-queries.js';

import {
  DefineDeductionBody,
  DefineGroupBody,
  MovePeriodBody,
  OpenPeriodBody,
} from './payroll.dto.js';
import { PayrollDispatcher } from './payroll-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Configuration and the period calendar: groups, deductions, periods and the dashboard.
 *
 * **Every route here is a literal segment**, and this controller is declared before the ones
 * carrying parameterised segments at the same depth. Route ordering is load-bearing rather than
 * cosmetic: Nest resolves by declaration order, and a `:something` declared first would swallow
 * `dashboard` (the Phase 10 lesson).
 *
 * Authorization is **not** decided here. Each application handler declares the permission it
 * requires and the kernel's pipeline enforces it before the handler runs, so a controller cannot
 * accidentally widen access by forgetting a guard — and cannot narrow it either.
 */
@ApiTags('payroll')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'payroll', version: '1' })
export class PayrollConfigurationController {
  public constructor(private readonly dispatcher: PayrollDispatcher) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'The overview, including the counts that reveal a failure' })
  @ApiOkResponse({
    description: 'Stale runs and unresolved exceptions are on this view deliberately.',
  })
  public async dashboard(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadPayrollDashboard>({ queryName: 'payroll.dashboard' }),
    );
  }

  @Get('groups')
  @ApiOperation({ summary: 'The payroll groups configured for this tenant' })
  public async groups(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListPayrollGroups>({ queryName: 'payroll.groups' }),
    );
  }

  @Post('groups')
  @ApiOperation({ summary: 'Define a payroll group: who is paid together, and under what policy' })
  public async defineGroup(@Body() body: DefineGroupBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefinePayrollGroupCommand>({
        commandName: 'payroll.define-group',
        ...body,
      }),
    );
  }

  @Get('deduction-definitions')
  @ApiOperation({ summary: "A group's configured deductions" })
  @ApiOkResponse({
    description:
      'Generic definitions only. No rate, threshold, bracket or authority name ships in this product.',
  })
  public async deductions(@Query('payrollGroupId') payrollGroupId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListDeductions>({
        queryName: 'payroll.deduction-definitions',
        payrollGroupId,
      }),
    );
  }

  @Post('deduction-definitions')
  @ApiOperation({ summary: 'Define a deduction: a fixed amount or a share of gross' })
  public async defineDeduction(@Body() body: DefineDeductionBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineDeductionCommand>({
        commandName: 'payroll.define-deduction',
        ...body,
      }),
    );
  }

  @Get('periods')
  @ApiOperation({ summary: 'The payroll periods, most recent first' })
  public async periods(@Query() query: Record<string, string>): Promise<unknown> {
    const page = paged(query);

    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListPeriods>({
        queryName: 'payroll.periods',
        ...page,
      }),
    );
  }

  @Post('periods')
  @ApiOperation({ summary: 'Open a payroll period for a group' })
  @ApiOkResponse({
    description:
      'Overlapping periods for one group are refused by the database, not by a preceding read.',
  })
  public async openPeriod(@Body() body: OpenPeriodBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, OpenPayrollPeriodCommand>({
        commandName: 'payroll.open-period',
        ...body,
      }),
    );
  }

  @Post('periods/:payrollPeriodId/status')
  @ApiOperation({ summary: 'Move a period through its lifecycle' })
  public async movePeriod(
    @Param('payrollPeriodId') payrollPeriodId: string,
    @Body() body: MovePeriodBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MovePeriodCommand>({
        commandName: 'payroll.move-period',
        payrollPeriodId,
        ...body,
      }),
    );
  }
}
