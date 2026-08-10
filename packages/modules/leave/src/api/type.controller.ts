import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  DefineLeaveTypeCommand,
  PublishLeaveTypeCommand,
} from '../application/type.use-case.js';
import type { ListTypes } from '../application/definition-queries.js';

import { DefineLeaveTypeBody, VersionedBody } from './definition.dto.js';
import { LeaveDispatcher } from './leave-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The kinds of leave a tenant offers.
 *
 * **The list starts empty and stays empty until somebody configures it.** There is no seed, no
 * suggestion and no default to delete. A tenant that has configured no leave types gets an empty
 * collection, and the screen says so.
 *
 * Publication is a `POST` to a sub-resource rather than a `PATCH` of a status field, because
 * publishing is an act with a consequence — every policy, entitlement and request in the tenant
 * will reference the published type by identity — and it is behind its own permission.
 */
@ApiTags('leave')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'leave/types', version: '1' })
export class LeaveTypeController {
  public constructor(private readonly dispatcher: LeaveDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The configured leave types. Empty until a tenant configures one' })
  @ApiOkResponse({ description: 'Every leave type this tenant has defined.' })
  public async list(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListTypes>({ queryName: 'leave.types' }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Draft a leave type' })
  public async define(@Body() body: DefineLeaveTypeBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineLeaveTypeCommand>({
        commandName: 'leave.define-type',
        ...body,
      }),
    );
  }

  @Post(':leaveTypeId/publication')
  @ApiOperation({ summary: 'Freeze a leave type, so policies may reference it' })
  public async publish(
    @Param('leaveTypeId') leaveTypeId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishLeaveTypeCommand>({
        commandName: 'leave.publish-type',
        leaveTypeId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
