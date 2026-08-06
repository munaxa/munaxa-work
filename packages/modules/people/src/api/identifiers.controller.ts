import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AmendIdentifierCommand,
  RecordIdentifierCommand,
  WithdrawIdentifierCommand,
} from '../application/identifier.use-case.js';
import type { RecordNationalityCommand } from '../application/profile.use-case.js';

import {
  AmendIdentifierBody,
  RecordIdentifierBody,
  RecordNationalityBody,
  VersionedBody,
} from './people.dto.js';
import { PeopleDispatcher } from './people-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Government identifiers and citizenships.
 *
 * There is deliberately **no endpoint that changes an identifier's value** and **no endpoint that
 * deletes one**. A different number is a different document — a renewed passport has a new number
 * and a new expiry, and recording it over the old one would erase the document a five-year-old
 * visa application was made against (AD-009). Renewal is a `POST` and a withdrawal.
 *
 * Reading a value is not on this controller at all: it is a section of the person's profile,
 * guarded by `people.identifier.read-value` and recorded when it is exercised.
 */
@ApiTags('people')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'people', version: '1' })
export class IdentifiersController {
  public constructor(private readonly dispatcher: PeopleDispatcher) {}

  @Post(':personId/identifiers')
  @ApiOperation({
    summary: 'Record a government or business identifier. Duplicate detection runs first',
  })
  @ApiConflictResponse({
    description:
      'The identifier may belong to another person. The refusal names the kind, never the number.',
  })
  @ApiOkResponse({ description: 'The identifier, and how many duplicates were queued.' })
  public async record(
    @Param('personId') personId: string,
    @Body() body: RecordIdentifierBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-identifier',
        personId,
        identifierType: body.identifierType,
        value: body.value,
        ...(body.issuingCountry === undefined ? {} : { issuingCountry: body.issuingCountry }),
        ...(body.issuedOn === undefined ? {} : { issuedOn: body.issuedOn }),
        ...(body.expiresOn === undefined ? {} : { expiresOn: body.expiresOn }),
        ...(body.isPrimary === undefined ? {} : { isPrimary: body.isPrimary }),
        ...(body.acknowledgedDuplicates === undefined
          ? {}
          : { acknowledgedDuplicates: body.acknowledgedDuplicates }),
      } satisfies RecordIdentifierCommand),
    );
  }

  @Patch('identifiers/:identifierId')
  @ApiOperation({ summary: 'Correct the dates or the primary flag. The value is not amendable' })
  @ApiOkResponse({ description: 'The identifier.' })
  public async amend(
    @Param('identifierId') identifierId: string,
    @Body() body: AmendIdentifierBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.amend-identifier',
        identifierId,
        ...(body.issuedOn === undefined ? {} : { issuedOn: body.issuedOn }),
        ...(body.expiresOn === undefined ? {} : { expiresOn: body.expiresOn }),
        ...(body.isPrimary === undefined ? {} : { isPrimary: body.isPrimary }),
        expectedVersion: body.expectedVersion,
      } satisfies AmendIdentifierCommand),
    );
  }

  @Patch('identifiers/:identifierId/withdrawal')
  @ApiOperation({
    summary: 'Withdraw a document. The row survives with its match key, so history still answers',
  })
  @ApiOkResponse({ description: 'The identifier.' })
  public async withdraw(
    @Param('identifierId') identifierId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.withdraw-identifier',
        identifierId,
        expectedVersion: body.expectedVersion,
      } satisfies WithdrawIdentifierCommand),
    );
  }

  @Post(':personId/nationalities')
  @ApiOperation({
    summary: 'Record a citizenship. A person may hold several — dual nationality is ordinary',
  })
  @ApiOkResponse({ description: 'The nationality.' })
  public async recordNationality(
    @Param('personId') personId: string,
    @Body() body: RecordNationalityBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-nationality',
        personId,
        countryCode: body.countryCode,
        ...(body.isPrimary === undefined ? {} : { isPrimary: body.isPrimary }),
        ...(body.acquiredOn === undefined ? {} : { acquiredOn: body.acquiredOn }),
      } satisfies RecordNationalityCommand),
    );
  }
}
