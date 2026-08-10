import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  RaiseLeaveRequestCommand,
  SubmitLeaveRequestCommand,
} from '../application/request.use-case.js';
import type { WithdrawLeaveRequestCommand } from '../application/cancellation.use-case.js';
import type { AmendLeaveRequestCommand } from '../application/amendment.use-case.js';
import type { ReadCalendar, ReadRequest, SearchRequests } from '../application/request-queries.js';

import { AmendBody, RaiseRequestBody } from './leave.dto.js';
import { VersionedBody } from './definition.dto.js';
import { LeaveDispatcher } from './leave-dispatcher.js';
import { paging, requestFilters } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Raising leave, submitting it, taking it back, and changing it.
 *
 * **Raising and submitting are separate**, because a draft asserts nothing: it consumes no balance
 * and blocks no date, so somebody working out how to fit a holiday around a project is not blocking
 * their own dates while they think about it.
 *
 * **An amendment is a new request, not an edit.** `POST :id/amendment` creates a request that
 * supersedes the original; the original keeps its rows and its ledger entries, and its consumption
 * is reversed only when the amendment is approved.
 *
 * A request overlapping existing leave is refused with **422 and the date that collided** — the
 * database's exclusion constraint is the guarantee, and the message is what makes it useful.
 */
@ApiTags('leave')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@ApiUnprocessableEntityResponse({ description: 'A well-formed request the policy refused.' })
@Controller({ path: 'leave/requests', version: '1' })
export class LeaveRequestController {
  public constructor(private readonly dispatcher: LeaveDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The leave register, paged and filterable' })
  @ApiOkResponse({ description: 'A page of requests with their day breakdown.' })
  public async list(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchRequests>({
        queryName: 'leave.requests',
        ...requestFilters(query),
        ...paging(query),
      }),
    );
  }

  /** Declared before `:leaveRequestId`, or the literal would be captured as an identifier. */
  @Get('calendar')
  @ApiOperation({ summary: 'Who is away, over a date range. No reason text' })
  public async calendar(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCalendar>({
        queryName: 'leave.calendar',
        from: query['from'] ?? '',
        to: query['to'] ?? '',
        ...(query['employmentId'] === undefined ? {} : { employmentId: query['employmentId'] }),
      }),
    );
  }

  @Get(':leaveRequestId')
  @ApiOperation({ summary: 'One request, with the dates it covers' })
  public async read(@Param('leaveRequestId') leaveRequestId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadRequest>({
        queryName: 'leave.request',
        leaveRequestId,
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Raise a request. A draft consumes nothing and blocks nothing' })
  public async raise(@Body() body: RaiseRequestBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RaiseLeaveRequestCommand>({
        commandName: 'leave.raise-request',
        ...body,
      } as RaiseLeaveRequestCommand),
    );
  }

  @Post(':leaveRequestId/submission')
  @ApiOperation({ summary: 'Assert the request. A policy requiring no approval approves it here' })
  public async submit(
    @Param('leaveRequestId') leaveRequestId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, SubmitLeaveRequestCommand>({
        commandName: 'leave.submit-request',
        leaveRequestId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':leaveRequestId/withdrawal')
  @ApiOperation({ summary: 'Take back an undecided request. Refused once a decision exists' })
  public async withdraw(
    @Param('leaveRequestId') leaveRequestId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, WithdrawLeaveRequestCommand>({
        commandName: 'leave.withdraw-request',
        leaveRequestId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':leaveRequestId/amendment')
  @ApiOperation({ summary: 'Supersede an approved request with a new one' })
  public async amend(
    @Param('leaveRequestId') leaveRequestId: string,
    @Body() body: AmendBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendLeaveRequestCommand>({
        commandName: 'leave.amend-request',
        leaveRequestId,
        ...body,
      } as AmendLeaveRequestCommand),
    );
  }
}
