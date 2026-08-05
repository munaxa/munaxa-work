import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  LinkEmployment,
  MakeEmploymentPrimary,
  UnlinkEmployment,
} from '../application/employment-linking.use-case.js';

import { LinkEmploymentBody, ReasonedChangeBody } from './identity.dto.js';
import { IdentityDispatcher } from './identity-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Attaching a job to a person, detaching it, and choosing which of several is the main one.
 *
 * The employment itself belongs to Phase 5 and is referenced by identifier only. Detaching a job
 * never removes the person (AD-008), and a member may hold several at once (AD-006).
 */
@ApiTags('identity')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'identity', version: '1' })
export class EmploymentLinkController {
  public constructor(private readonly dispatcher: IdentityDispatcher) {}

  @Post('members/:membershipId/employments')
  @ApiOperation({ summary: 'Attach a job to a member. Concurrent employment is supported' })
  @ApiOkResponse({ description: 'The employment link.' })
  public async linkEmployment(
    @Param('membershipId') membershipId: string,
    @Body() body: LinkEmploymentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.link-employment',
        membershipId,
        employmentId: body.employmentId,
        isPrimary: body.isPrimary,
      } satisfies LinkEmployment),
    );
  }

  @Patch('employments/:linkId/primary')
  @ApiOperation({ summary: 'Make this the member’s main job, demoting the incumbent' })
  @ApiOkResponse({ description: 'The promoted link.' })
  @ApiUnprocessableEntityResponse({ description: 'The link is detached, or already primary.' })
  public async makePrimary(
    @Param('linkId') linkId: string,
    @Body() body: ReasonedChangeBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.make-employment-primary',
        linkId,
        expectedVersion: body.expectedVersion,
      } satisfies MakeEmploymentPrimary),
    );
  }

  @Delete('employments/:linkId')
  @ApiOperation({ summary: 'Detach a job. The person is untouched' })
  @ApiOkResponse({ description: 'The detached link.' })
  public async unlinkEmployment(
    @Param('linkId') linkId: string,
    @Body() body: ReasonedChangeBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.unlink-employment',
        linkId,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      } satisfies UnlinkEmployment),
    );
  }
}
