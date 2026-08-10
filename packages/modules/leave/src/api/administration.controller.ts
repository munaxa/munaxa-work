import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AdjustBalanceCommand,
  GrantEntitlementCommand,
} from '../application/entitlement.use-case.js';
import type {
  ListAdjustments,
  ListEntitlements,
  ReadDashboard,
} from '../application/definition-queries.js';

import { AdjustBalanceBody, GrantEntitlementBody } from './leave.dto.js';
import { LeaveDispatcher } from './leave-dispatcher.js';
import { adjustmentFilters, entitlementFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The dashboard, entitlement grants and adjustments.
 *
 * The dashboard carries `balancesAwaitingRecalculation`, which is the number that grows when
 * something is quietly not working. It is on the screen for the reason Attendance's equivalent is:
 * a number a human can see is a number a human notices growing.
 *
 * **An adjustment requires a reason code and a written note**, and both are enforced by the DTO,
 * the domain and the database. It is the one movement in the ledger that no rule produced and no
 * request explains, which makes it the one an auditor looks at first.
 */
@ApiTags('leave')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'leave', version: '1' })
export class LeaveAdministrationController {
  public constructor(private readonly dispatcher: LeaveDispatcher) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Pending approvals, who is away, and what is awaiting recalculation' })
  @ApiOkResponse({
    description: 'The numbers an administrator watches, including the failure one.',
  })
  public async dashboard(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDashboard>({
        queryName: 'leave.dashboard',
        ...(query['onDate'] === undefined ? {} : { onDate: query['onDate'] }),
      }),
    );
  }

  @Get('entitlements')
  @ApiOperation({ summary: 'Grants by employment and leave year, with their source' })
  public async entitlements(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListEntitlements>({
        queryName: 'leave.entitlements',
        ...entitlementFilters(query),
        ...paging(query),
      }),
    );
  }

  @Post('entitlements')
  @ApiOperation({ summary: 'Grant entitlement. Writes a credit to the ledger in one transaction' })
  public async grant(@Body() body: GrantEntitlementBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, GrantEntitlementCommand>({
        commandName: 'leave.grant-entitlement',
        ...body,
      }),
    );
  }

  @Get('adjustments')
  @ApiOperation({ summary: 'Every manual movement, with its actor and its reason' })
  public async adjustments(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListAdjustments>({
        queryName: 'leave.adjustments',
        ...adjustmentFilters(query),
        ...paging(query),
      }),
    );
  }

  @Post('adjustments')
  @ApiOperation({ summary: 'Move a balance by hand. A reason and a note are both required' })
  public async adjust(@Body() body: AdjustBalanceBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AdjustBalanceCommand>({
        commandName: 'leave.adjust-balance',
        ...body,
      }),
    );
  }
}
