import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  DecideOfferCommand,
  DraftOfferCommand,
  SubmitOfferCommand,
} from '../application/offer.use-case.js';
import type {
  CloseOfferCommand,
  IssueOfferCommand,
  RecordOfferResponseCommand,
} from '../application/offer-response.use-case.js';

import {
  CloseOfferBody,
  DecideOfferBody,
  DraftOfferBody,
  IssueOfferBody,
  OfferResponseBody,
} from './offer.dto.js';
import { VersionedBody } from './requisition.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Offers: what was proposed, who approved it, and what the candidate said.
 *
 * **A renegotiated offer is a new version**, never an edit — version 1 survives, and at most one
 * version is live at a time. **The compensation is opaque** (A-5): recorded as authored, published
 * unchanged, never computed with. **Approving is its own permission**, because the recruiter who
 * drafted the terms is not automatically the person who may approve them.
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such offer or application in this tenant.' })
@ApiConflictResponse({ description: 'The version supplied is not the version stored.' })
@Controller({ path: 'recruitment/offers', version: '1' })
export class OffersController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Post()
  @ApiOperation({ summary: 'Draft an offer. Drafting again produces the next version' })
  @ApiCreatedResponse({ description: 'The offer identifier, its number and its version.' })
  public async draft(@Body() body: DraftOfferBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DraftOfferCommand>({
        commandName: 'recruitment.draft-offer',
        ...body,
      }),
    );
  }

  @Post(':offerId/submission')
  @ApiOperation({ summary: 'Submit the offer for internal decision' })
  public async submit(
    @Param('offerId') offerId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, SubmitOfferCommand>({
        commandName: 'recruitment.submit-offer',
        offerId,
        ...body,
      }),
    );
  }

  @Post(':offerId/decision')
  @ApiOperation({ summary: 'Approve or reject. Requires recruitment.offer.approve' })
  @ApiOkResponse({ description: 'The decision is recorded against the authenticated human.' })
  public async decide(
    @Param('offerId') offerId: string,
    @Body() body: DecideOfferBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DecideOfferCommand>({
        commandName: 'recruitment.decide-offer',
        offerId,
        ...body,
      }),
    );
  }

  @Post(':offerId/issue')
  @ApiOperation({ summary: 'Issue an approved offer to the candidate' })
  @ApiConflictResponse({
    description:
      'Another version is already live. Two open offers is two answers to which terms bind.',
  })
  public async issue(
    @Param('offerId') offerId: string,
    @Body() body: IssueOfferBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, IssueOfferCommand>({
        commandName: 'recruitment.issue-offer',
        offerId,
        ...body,
      }),
    );
  }

  @Post(':offerId/response')
  @ApiOperation({ summary: 'Record what the candidate answered' })
  @ApiOkResponse({
    description:
      'An acceptance moves nothing else on its own: the hire is a separate, separately permissioned act.',
  })
  public async respond(
    @Param('offerId') offerId: string,
    @Body() body: OfferResponseBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordOfferResponseCommand>({
        commandName: 'recruitment.record-offer-response',
        offerId,
        ...body,
      }),
    );
  }

  @Post(':offerId/closure')
  @ApiOperation({ summary: 'Withdraw an offer, or record that it expired' })
  public async close(
    @Param('offerId') offerId: string,
    @Body() body: CloseOfferBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CloseOfferCommand>({
        commandName: 'recruitment.close-offer',
        offerId,
        ...body,
      }),
    );
  }
}
