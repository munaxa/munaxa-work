import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UnauthorizedException } from '@nestjs/common';
import type { PagedResult } from '@work/kernel';

import type { InvitationView } from '../contracts/views.js';
import type { ListInvitations } from '../application/identity-queries.js';
import type { AcceptInvitation } from '../application/accept-invitation.use-case.js';
import type { InviteMember, RevokeInvitation } from '../application/invite-member.use-case.js';

import type { AuthenticatedRequest } from './authenticated-request.js';
import { InviteMemberBody, PageQuery, ReasonedChangeBody } from './identity.dto.js';
import { IdentityDispatcher } from './identity-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

const DEFAULT_PAGE_SIZE = 25;

@ApiTags('identity')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'identity/invitations', version: '1' })
export class InvitationsController {
  public constructor(private readonly dispatcher: IdentityDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Invitations this tenant has issued' })
  @ApiOkResponse({ description: 'A page of invitations.' })
  public async list(@Query() query: PageQuery): Promise<PagedResult<InvitationView>> {
    return unwrapOrThrow(
      await this.dispatcher.ask<PagedResult<InvitationView>, ListInvitations>({
        queryName: 'identity.list-invitations',
        page: query.page ?? 1,
        pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        ...(query.status === undefined ? {} : { status: query.status }),
      } satisfies ListInvitations),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Invite somebody to join this tenant' })
  @ApiOkResponse({ description: 'The invitation, and when it lapses.' })
  @ApiUnprocessableEntityResponse({
    description: 'An invitation for this address is already open.',
  })
  public async invite(@Body() body: InviteMemberBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.invite-member',
        email: body.email,
        ...(body.portals === undefined ? {} : { portals: body.portals }),
      } satisfies InviteMember),
    );
  }

  /**
   * Accepts an invitation, on behalf of whoever Platform authenticated.
   *
   * The identity of the acceptor comes from the principal and from nowhere else — not from the
   * body, not from a header, not from the invitation. Whoever follows an intercepted invitation
   * link still has to be somebody Platform vouched for, and the address on their account still
   * has to be the address that was invited.
   */
  @Post(':invitationId/acceptance')
  @ApiOperation({ summary: 'Accept an invitation as the authenticated Platform user' })
  @ApiOkResponse({ description: 'The workforce user and the membership that now exist.' })
  @ApiUnauthorizedResponse({ description: 'No authenticated Platform principal.' })
  @ApiUnprocessableEntityResponse({
    description: 'Withdrawn, lapsed, already accepted, or addressed to somebody else.',
  })
  public async accept(
    @Param('invitationId') invitationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const { principal } = request;

    if (principal === undefined) throw new UnauthorizedException();

    // An invitation is addressed to a person. Without an address on the Platform account there
    // is nothing to check the acceptor against, and accepting anyway would let any authenticated
    // account claim any open invitation.
    if (principal.email === undefined) {
      throw new UnauthorizedException('The Platform account asserts no address.');
    }

    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.accept-invitation',
        invitationId,
        platformUserId: principal.platformUserId,
        principalEmail: principal.email,
      } satisfies AcceptInvitation),
    );
  }

  @Delete(':invitationId')
  @ApiOperation({ summary: 'Withdraw an invitation that has not been accepted' })
  @ApiOkResponse({ description: 'The withdrawn invitation.' })
  public async revoke(
    @Param('invitationId') invitationId: string,
    @Body() body: ReasonedChangeBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.revoke-invitation',
        invitationId,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      } satisfies RevokeInvitation),
    );
  }
}
