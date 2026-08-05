import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { GrantPortal, RevokePortal } from '../application/portal-access.use-case.js';

import { GrantPortalBody, ReasonedChangeBody } from './identity.dto.js';
import { IdentityDispatcher } from './identity-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Which of the product's portals a tenant has opened to a member.
 *
 * Business configuration, not authorization (AD-007): opening the manager portal puts an
 * application on somebody's home screen and says nothing about what they may approve.
 */
@ApiTags('identity')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'identity', version: '1' })
export class PortalAccessController {
  public constructor(private readonly dispatcher: IdentityDispatcher) {}

  @Post('members/:membershipId/portals')
  @ApiOperation({ summary: 'Open a portal to a member. Business configuration, not permission' })
  @ApiOkResponse({ description: 'The portal assignment.' })
  public async grantPortal(
    @Param('membershipId') membershipId: string,
    @Body() body: GrantPortalBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.grant-portal',
        membershipId,
        portal: body.portal,
      } satisfies GrantPortal),
    );
  }

  @Delete('portals/:assignmentId')
  @ApiOperation({ summary: 'Withdraw a portal. The record survives, revoked' })
  @ApiOkResponse({ description: 'The revoked assignment.' })
  public async revokePortal(
    @Param('assignmentId') assignmentId: string,
    @Body() body: ReasonedChangeBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.revoke-portal',
        assignmentId,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      } satisfies RevokePortal),
    );
  }
}
