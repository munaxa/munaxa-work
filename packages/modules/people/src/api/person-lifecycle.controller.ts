import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AmendPersonCommand,
  ChangePersonStatusCommand,
} from '../application/person.use-case.js';
import type {
  RecordPersonNameCommand,
  RevisePersonMetadataCommand,
  SetPersonPhotoCommand,
} from '../application/person-record.use-case.js';

import {
  AmendPersonBody,
  ChangePersonStatusBody,
  RecordNameBody,
  ReviseMetadataBody,
  SetPhotoBody,
} from './people.dto.js';
import { PeopleDispatcher } from './people-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Changing a person who already exists: details, status, legal name, metadata, photograph, merge.
 *
 * Apart from `people.controller.ts` because that one is the *register* — search, read and the
 * create path with its duplicate check — and this is the aggregate's lifecycle. Every operation
 * here carries `expectedVersion` except the name change, which needs none: a new name opens a
 * period rather than replacing a value, so there is nothing to be stale against.
 */
@ApiTags('people')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'people', version: '1' })
export class PersonLifecycleController {
  public constructor(private readonly dispatcher: PeopleDispatcher) {}

  @Patch(':personId')
  @ApiOperation({ summary: 'Correct the facts that have no history' })
  @ApiOkResponse({ description: 'The person.' })
  public async amend(
    @Param('personId') personId: string,
    @Body() body: AmendPersonBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.amend-person',
        personId,
        ...(body.dateOfBirth === undefined ? {} : { dateOfBirth: body.dateOfBirth }),
        ...(body.placeOfBirth === undefined ? {} : { placeOfBirth: body.placeOfBirth }),
        ...(body.genderCode === undefined ? {} : { genderCode: body.genderCode }),
        ...(body.maritalStatusCode === undefined
          ? {}
          : { maritalStatusCode: body.maritalStatusCode }),
        expectedVersion: body.expectedVersion,
      } satisfies AmendPersonCommand),
    );
  }

  @Patch(':personId/status')
  @ApiOperation({ summary: 'Move a person through their lifecycle. Archiving never deletes' })
  @ApiOkResponse({ description: 'The person.' })
  public async changeStatus(
    @Param('personId') personId: string,
    @Body() body: ChangePersonStatusBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.change-person-status',
        personId,
        status: body.status,
        expectedVersion: body.expectedVersion,
      } satisfies ChangePersonStatusCommand),
    );
  }

  @Post(':personId/names')
  @ApiOperation({ summary: 'Record a legal name change, effective from a date (ADR-0037)' })
  @ApiOkResponse({ description: 'The person.' })
  public async recordName(
    @Param('personId') personId: string,
    @Body() body: RecordNameBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-person-name',
        personId,
        legalName: { ...body.legalName },
        ...(body.preferredName === undefined ? {} : { preferredName: { ...body.preferredName } }),
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies RecordPersonNameCommand),
    );
  }

  @Patch(':personId/metadata')
  @ApiOperation({ summary: 'Replace tenant-authored metadata. Stored, never interpreted' })
  @ApiOkResponse({ description: 'The person.' })
  public async reviseMetadata(
    @Param('personId') personId: string,
    @Body() body: ReviseMetadataBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.revise-person-metadata',
        personId,
        metadata: body.metadata,
        expectedVersion: body.expectedVersion,
      } satisfies RevisePersonMetadataCommand),
    );
  }

  @Patch(':personId/photo')
  @ApiOperation({ summary: 'Attach or remove a photograph held in the document store' })
  @ApiOkResponse({ description: 'The person.' })
  public async setPhoto(
    @Param('personId') personId: string,
    @Body() body: SetPhotoBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.set-person-photo',
        personId,
        ...(body.documentId === undefined ? {} : { documentId: body.documentId }),
        expectedVersion: body.expectedVersion,
      } satisfies SetPersonPhotoCommand),
    );
  }
}
