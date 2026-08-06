import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ApplyTagCommand, WriteNoteCommand } from '../application/annotation.use-case.js';
import type {
  RecordCapabilityCommand,
  RecordHistoryCommand,
  WithdrawCapabilityCommand,
} from '../application/profile.use-case.js';

import { VersionedBody } from './people.dto.js';
import {
  ApplyTagBody,
  RecordCapabilityBody,
  RecordHistoryBody,
  WriteNoteBody,
} from './profile.dto.js';
import { PeopleDispatcher } from './people-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The claims: capabilities, history, tags and notes.
 *
 * There is no `PATCH` and no `DELETE` on any of them. Each is withdrawn rather than removed
 * (AD-009), and a note is neither — an editable note cannot be relied on in a disciplinary case,
 * and a deletable one is a record somebody can make disappear. A note that was wrong is superseded
 * by a further note.
 */
@ApiTags('people')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'people', version: '1' })
export class ProfileController {
  public constructor(private readonly dispatcher: PeopleDispatcher) {}

  @Post(':personId/capabilities')
  @ApiOperation({
    summary: 'Record a language or a skill. Self-declared — Learning owns assessment',
  })
  @ApiOkResponse({ description: 'The capability.' })
  public async recordCapability(
    @Param('personId') personId: string,
    @Body() body: RecordCapabilityBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-capability',
        personId,
        kind: body.kind,
        capabilityCode: body.capabilityCode,
        ...(body.title === undefined ? {} : { title: { ...body.title } }),
        level: body.level,
        ...(body.yearsOfExperience === undefined
          ? {}
          : { yearsOfExperience: body.yearsOfExperience }),
        ...(body.lastUsedOn === undefined ? {} : { lastUsedOn: body.lastUsedOn }),
      } satisfies RecordCapabilityCommand),
    );
  }

  @Patch('capabilities/:capabilityId/withdrawal')
  @ApiOperation({ summary: 'Withdraw a capability. The claim stays answerable' })
  @ApiOkResponse({ description: 'The capability.' })
  public async withdrawCapability(
    @Param('capabilityId') capabilityId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.withdraw-capability',
        capabilityId,
        expectedVersion: body.expectedVersion,
      } satisfies WithdrawCapabilityCommand),
    );
  }

  @Post(':personId/history')
  @ApiOperation({
    summary: 'Record education, experience elsewhere or a certification. Not employment here',
  })
  @ApiOkResponse({ description: 'The history record.' })
  public async recordHistory(
    @Param('personId') personId: string,
    @Body() body: RecordHistoryBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.record-history',
        personId,
        kind: body.kind,
        organizationName: { ...body.organizationName },
        title: { ...body.title },
        ...(body.fieldOfStudy === undefined ? {} : { fieldOfStudy: { ...body.fieldOfStudy } }),
        ...(body.countryCode === undefined ? {} : { countryCode: body.countryCode }),
        fromDate: body.fromDate,
        ...(body.toDate === undefined ? {} : { toDate: body.toDate }),
        ...(body.expiresOn === undefined ? {} : { expiresOn: body.expiresOn }),
        ...(body.reference === undefined ? {} : { reference: body.reference }),
      } satisfies RecordHistoryCommand),
    );
  }

  @Post(':personId/tags')
  @ApiOperation({ summary: 'Apply a tag. A code, never a list this product ships' })
  @ApiOkResponse({ description: 'The tag.' })
  public async applyTag(
    @Param('personId') personId: string,
    @Body() body: ApplyTagBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.apply-tag',
        personId,
        tagCode: body.tagCode,
      } satisfies ApplyTagCommand),
    );
  }

  @Post(':personId/notes')
  @ApiOperation({
    summary: 'Write a note. The author comes from the context; a note is never amended or deleted',
  })
  @ApiOkResponse({ description: 'The note.' })
  public async writeNote(
    @Param('personId') personId: string,
    @Body() body: WriteNoteBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.write-note',
        personId,
        categoryCode: body.categoryCode,
        body: body.body,
      } satisfies WriteNoteCommand),
    );
  }
}
