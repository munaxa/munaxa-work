import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type { CreateDelegation, RevokeDelegation } from '../application/delegation.use-case.js';

import { CreateDelegationBody, ReasonedChangeBody } from './identity.dto.js';
import { IdentityDispatcher } from './identity-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Arranging and withdrawing cover: one member acting for another, for a period and a scope.
 *
 * Phase 2 records the fact; Workflow consumes it from Phase 16 (AD-010). The scope is opaque
 * here — this module would have to know every future domain's operations to interpret it.
 */
@ApiTags('identity')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'identity', version: '1' })
export class DelegationController {
  public constructor(private readonly dispatcher: IdentityDispatcher) {}

  @Post('members/:membershipId/delegations')
  @ApiOperation({ summary: 'Arrange cover: another member acts for this one, for a period' })
  @ApiOkResponse({ description: 'The delegation.' })
  @ApiUnprocessableEntityResponse({
    description: 'Delegation to self, an inverted period, or a period that has already passed.',
  })
  public async delegate(
    @Param('membershipId') membershipId: string,
    @Body() body: CreateDelegationBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.create-delegation',
        delegatorMembershipId: membershipId,
        delegateMembershipId: body.delegateMembershipId,
        scope: body.scope,
        effectiveFrom: new Date(body.effectiveFrom),
        effectiveTo: new Date(body.effectiveTo),
        reason: body.reason,
      } satisfies CreateDelegation),
    );
  }

  @Delete('delegations/:delegationId')
  @ApiOperation({ summary: 'Withdraw cover before its period ends' })
  @ApiOkResponse({ description: 'The revoked delegation.' })
  public async revokeDelegation(
    @Param('delegationId') delegationId: string,
    @Body() body: ReasonedChangeBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.revoke-delegation',
        delegationId,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      } satisfies RevokeDelegation),
    );
  }
}
