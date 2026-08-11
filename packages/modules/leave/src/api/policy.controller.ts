import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AssignLeavePolicyCommand,
  DefineLeavePolicyCommand,
  PublishLeavePolicyCommand,
} from '../application/policy.use-case.js';
import type { ListPolicies } from '../application/definition-queries.js';

import { AssignPolicyBody, DefineLeavePolicyBody, VersionedBody } from './definition.dto.js';
import { LeaveDispatcher } from './leave-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Policy versions and the scopes they govern.
 *
 * Three acts, three endpoints, because they have three different consequences. Drafting changes
 * nothing for anybody. **Publishing** freezes rules everybody assigned to them will be measured by,
 * and is behind its own permission. **Assigning** decides who those rules apply to, and is where a
 * mistake reaches the most people at once — which is why an assignment overlapping another at the
 * same specificity is refused with a 409 rather than silently merged.
 *
 * A published version is immutable. Changing a policy drafts the next version, and both the request
 * and the ledger entry record which version governed them — so a policy widened in June does not
 * retroactively re-entitle March.
 */
@ApiTags('leave')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'leave/policies', version: '1' })
export class LeavePolicyController {
  public constructor(private readonly dispatcher: LeaveDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Policy versions, their effective dates and their assignments' })
  @ApiOkResponse({ description: 'Every policy version, with the scopes it is bound to.' })
  public async list(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListPolicies>({
        queryName: 'leave.policies',
        ...(query['leaveTypeId'] === undefined ? {} : { leaveTypeId: query['leaveTypeId'] }),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Draft a policy version. Every threshold is inert until set' })
  public async define(@Body() body: DefineLeavePolicyBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineLeavePolicyCommand>({
        commandName: 'leave.define-policy',
        ...body,
      }),
    );
  }

  @Post(':leavePolicyId/publication')
  @ApiOperation({ summary: 'Freeze a policy version, so it may be assigned' })
  public async publish(
    @Param('leavePolicyId') leavePolicyId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishLeavePolicyCommand>({
        commandName: 'leave.publish-policy',
        leavePolicyId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }

  @Post(':leavePolicyId/assignments')
  @ApiOperation({ summary: 'Bind a published policy version to a scope, effective-dated' })
  public async assign(
    @Param('leavePolicyId') leavePolicyId: string,
    @Body() body: AssignPolicyBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AssignLeavePolicyCommand>({
        commandName: 'leave.assign-policy',
        leavePolicyId,
        ...body,
      }),
    );
  }
}
