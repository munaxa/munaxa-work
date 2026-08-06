import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  RecordEmergencyContactCommand,
  RecordPreferenceCommand,
} from '../application/residence.use-case.js';

import { RecordEmergencyContactBody, RecordPreferenceBody } from './contact.dto.js';
import { PeopleDispatcher } from './people-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Emergency contacts and preferences.
 *
 * Apart from the contacts controller because they are guarded by different permissions and read by
 * different people. An emergency contact is **another human being's data, held about somebody who
 * never consented to this system**, and a preference is often a statement about health, religion
 * or consent. Neither belongs behind the same permission as a work email address, and keeping the
 * transport separate makes that boundary visible in the routing table rather than only in a
 * permission constant.
 */
@ApiTags('people')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'people', version: '1' })
export class PersonalDetailsController {
  public constructor(private readonly dispatcher: PeopleDispatcher) {}

  @Post(':personId/emergency-contacts')
  @ApiOperation({ summary: 'Record who to reach in an emergency. Priority 1 is called first' })
  @ApiOkResponse({ description: 'The emergency contact.' })
  public async recordEmergencyContact(
    @Param('personId') personId: string,
    @Body() body: RecordEmergencyContactBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-emergency-contact',
        personId,
        name: { ...body.name },
        relationshipCode: body.relationshipCode,
        telephone: body.telephone,
        ...(body.alternateTelephone === undefined
          ? {}
          : { alternateTelephone: body.alternateTelephone }),
        ...(body.email === undefined ? {} : { email: body.email }),
        ...(body.priority === undefined ? {} : { priority: body.priority }),
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies RecordEmergencyContactCommand),
    );
  }

  @Post(':personId/preferences')
  @ApiOperation({
    summary: 'Record a personal preference, effective from a date. Consent is evidenced by date',
  })
  @ApiOkResponse({ description: 'The preference.' })
  public async recordPreference(
    @Param('personId') personId: string,
    @Body() body: RecordPreferenceBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-preference',
        personId,
        preferenceKey: body.preferenceKey,
        value: body.value,
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies RecordPreferenceCommand),
    );
  }
}
