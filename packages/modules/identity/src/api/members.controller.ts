import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { PagedResult } from '@work/kernel';

import type { TenantMembershipView } from '../contracts/views.js';
import type {
  DescribeMember,
  ListMemberships,
  MemberDescription,
  SearchMembers,
} from '../application/identity-queries.js';
import type {
  AdmitMember,
  ChangeMembership,
} from '../application/membership-lifecycle.use-case.js';

import { AdmitMemberBody, ChangeMembershipBody, PageQuery, SearchQuery } from './identity.dto.js';
import { IdentityDispatcher } from './identity-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

const DEFAULT_PAGE_SIZE = 25;

/**
 * The member register.
 *
 * Transport only: it validates the shape, sends a command or asks a query, and translates the
 * answer. It checks no permission — the pipeline does that centrally, before validation, so an
 * unauthorized caller learns nothing about whether their payload was well formed.
 */
@ApiTags('identity')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'identity/members', version: '1' })
export class MembersController {
  public constructor(private readonly dispatcher: IdentityDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The tenant’s members' })
  @ApiOkResponse({ description: 'A page of memberships.' })
  public async list(@Query() query: PageQuery): Promise<PagedResult<TenantMembershipView>> {
    return unwrapOrThrow(
      await this.dispatcher.ask<PagedResult<TenantMembershipView>, ListMemberships>({
        queryName: 'identity.list-memberships',
        page: query.page ?? 1,
        pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        ...(query.status === undefined ? {} : { status: query.status }),
      } satisfies ListMemberships),
    );
  }

  @Get('search')
  @ApiOperation({ summary: 'Find members by name, in any language their profile carries' })
  @ApiOkResponse({ description: 'Matching profiles.' })
  public async search(@Query() query: SearchQuery): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'identity.search-members',
        term: query.term,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
      } satisfies SearchMembers),
    );
  }

  @Get(':membershipId')
  @ApiOperation({ summary: 'Everything about one member' })
  @ApiOkResponse({ description: 'Membership, profile, preferences, portals, jobs, delegations.' })
  @ApiNotFoundResponse({ description: 'No such membership in this tenant.' })
  public async describe(@Param('membershipId') membershipId: string): Promise<MemberDescription> {
    return unwrapOrThrow(
      await this.dispatcher.ask<MemberDescription, DescribeMember>({
        queryName: 'identity.describe-member',
        membershipId,
      } satisfies DescribeMember),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Admit somebody whose Platform account is already known' })
  @ApiOkResponse({ description: 'The membership, admitted or readmitted.' })
  @ApiBadRequestResponse({ description: 'The request was malformed.' })
  @ApiUnprocessableEntityResponse({ description: 'A business rule refused it.' })
  public async admit(@Body() body: AdmitMemberBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.admit-member',
        platformUserId: body.platformUserId,
      } satisfies AdmitMember),
    );
  }

  @Patch(':membershipId')
  @ApiOperation({ summary: 'Suspend, reinstate or end a membership' })
  @ApiOkResponse({ description: 'The membership’s new state.' })
  @ApiUnprocessableEntityResponse({ description: 'The transition is not permitted from here.' })
  public async change(
    @Param('membershipId') membershipId: string,
    @Body() body: ChangeMembershipBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.change-membership',
        membershipId,
        transition: body.transition,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      } satisfies ChangeMembership),
    );
  }
}
