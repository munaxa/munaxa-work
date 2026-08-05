import { Body, Controller, Param, Put } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type { RevisePreference, ReviseProfile } from '../application/member-profile.use-case.js';

import { RevisePreferenceBody, ReviseProfileBody } from './identity.dto.js';
import { IdentityDispatcher } from './identity-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * A member's business-facing details, and how they want the product rendered for them.
 *
 * `PUT` rather than `PATCH` for both, because both replace the whole value. A partial update
 * makes "clear this field" unexpressible — the client cannot distinguish "leave the phone
 * number alone" from "remove it" — and every product that has tried has ended up with a
 * sentinel value meaning empty.
 */
@ApiTags('identity')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'identity/members/:membershipId', version: '1' })
export class MemberProfileController {
  public constructor(private readonly dispatcher: IdentityDispatcher) {}

  @Put('profile')
  @ApiOperation({ summary: 'The member’s name, title and work contact details' })
  @ApiOkResponse({ description: 'The profile.' })
  @ApiUnprocessableEntityResponse({
    description: 'The display name is missing one of the first-class languages.',
  })
  public async reviseProfile(
    @Param('membershipId') membershipId: string,
    @Body() body: ReviseProfileBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.revise-profile',
        membershipId,
        change: {
          displayName: body.displayName,
          ...(body.jobTitle === undefined ? {} : { jobTitle: body.jobTitle }),
          ...(body.businessEmail === undefined ? {} : { businessEmail: body.businessEmail }),
          ...(body.businessPhone === undefined ? {} : { businessPhone: body.businessPhone }),
        },
        ...(body.expectedVersion === undefined ? {} : { expectedVersion: body.expectedVersion }),
      } satisfies ReviseProfile),
    );
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Language, calendar, time zone and numerals' })
  @ApiOkResponse({ description: 'The preferences, and the direction they imply.' })
  @ApiUnprocessableEntityResponse({ description: 'An unknown time zone or language tag.' })
  public async revisePreference(
    @Param('membershipId') membershipId: string,
    @Body() body: RevisePreferenceBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'identity.revise-preference',
        membershipId,
        change: {
          ...(body.language === undefined ? {} : { language: body.language }),
          ...(body.calendar === undefined ? {} : { calendar: body.calendar }),
          ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone }),
          ...(body.numerals === undefined ? {} : { numerals: body.numerals }),
        },
        expectedVersion: body.expectedVersion,
      } satisfies RevisePreference),
    );
  }
}
