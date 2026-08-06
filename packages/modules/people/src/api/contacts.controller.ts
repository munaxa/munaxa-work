import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { CloseContactCommand, RecordContactCommand } from '../application/contact.use-case.js';
import type {
  CloseAddressCommand,
  RecordAddressCommand,
} from '../application/residence.use-case.js';

import { CloseAtBody, RecordAddressBody, RecordContactBody } from './contact.dto.js';
import { PeopleDispatcher } from './people-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Contact points and addresses, as versioned children.
 *
 * Every one of these is a `POST` that *records a new period* rather than a `PUT` that replaces a
 * value, and that is the API surface of the Versioned Child Entity pattern rather than an
 * accident of routing. A `PUT /addresses/{id}` would be an endpoint through which somebody's
 * address history is overwritten, and "where did this person live when that letter was posted" is
 * a question a settlement dispute asks months later.
 *
 * `PATCH .../closure` ends a period without replacing it, because "we no longer have a number for
 * this person" and "this is their new number" are different facts — and a system that could only
 * express the second invites a placeholder in place of the first.
 */
@ApiTags('people')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'people', version: '1' })
export class ContactsController {
  public constructor(private readonly dispatcher: PeopleDispatcher) {}

  @Post(':personId/contacts')
  @ApiOperation({ summary: 'Record a contact point, effective from a date' })
  @ApiConflictResponse({ description: 'The value may belong to another person.' })
  @ApiOkResponse({ description: 'The contact, and how many duplicates were queued.' })
  public async recordContact(
    @Param('personId') personId: string,
    @Body() body: RecordContactBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-contact',
        personId,
        channel: body.channel,
        purpose: body.purpose,
        value: body.value,
        ...(body.isPrimary === undefined ? {} : { isPrimary: body.isPrimary }),
        effectiveFrom: new Date(body.effectiveFrom),
        ...(body.acknowledgedDuplicates === undefined
          ? {}
          : { acknowledgedDuplicates: body.acknowledgedDuplicates }),
      } satisfies RecordContactCommand),
    );
  }

  @Patch('contacts/:contactId/closure')
  @ApiOperation({ summary: 'End a contact point without replacing it' })
  @ApiOkResponse({ description: 'The contact.' })
  public async closeContact(
    @Param('contactId') contactId: string,
    @Body() body: CloseAtBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.close-contact',
        contactId,
        effectiveTo: new Date(body.effectiveTo),
        expectedVersion: body.expectedVersion,
      } satisfies CloseContactCommand),
    );
  }

  @Post(':personId/addresses')
  @ApiOperation({
    summary: 'Record an address, effective from a date. No country’s format is assumed',
  })
  @ApiOkResponse({ description: 'The address.' })
  public async recordAddress(
    @Param('personId') personId: string,
    @Body() body: RecordAddressBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-address',
        personId,
        kind: body.kind,
        lines: body.lines.map((line) => ({ ...line })),
        city: { ...body.city },
        ...(body.region === undefined ? {} : { region: { ...body.region } }),
        ...(body.postalCode === undefined ? {} : { postalCode: body.postalCode }),
        countryCode: body.countryCode,
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies RecordAddressCommand),
    );
  }

  @Patch('addresses/:addressId/closure')
  @ApiOperation({ summary: 'End an address without replacing it' })
  @ApiOkResponse({ description: 'The address.' })
  public async closeAddress(
    @Param('addressId') addressId: string,
    @Body() body: CloseAtBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.close-address',
        addressId,
        effectiveTo: new Date(body.effectiveTo),
        expectedVersion: body.expectedVersion,
      } satisfies CloseAddressCommand),
    );
  }
}
