import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { LinkCandidateToPersonCommand } from '../application/candidate.use-case.js';
import type {
  AnonymizeCandidateCommand,
  RecordProfileEntryCommand,
} from '../application/candidate-record.use-case.js';

import { LinkPersonBody, ProfileEntryBody } from './candidate.dto.js';
import { VersionedBody } from './requisition.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What is attached to a candidate: what they claim, who they turn out to be, and their erasure.
 *
 * **Linking to a Person is explicit, permissioned and write-once.** A candidate already linked to
 * somebody else is refused rather than repointed, because moving a link moves a career.
 *
 * **Anonymizing deletes nothing.** Applications, interviews and offers still resolve and the audit
 * trail still reads; what goes is the name, the address and the telephone number. It invents no
 * retention period — *when* to run it is a policy question a country pack and the future GRC phase
 * own — and it has its own permission because it cannot be undone (A-9).
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such candidate in this tenant.' })
@Controller({ path: 'recruitment/candidates', version: '1' })
export class CandidateRecordsController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Post(':candidateId/profile-entries')
  @ApiOperation({ summary: 'Record a skill, a period of experience, a qualification' })
  @ApiCreatedResponse({
    description:
      'Self-declared and never verified by this module. Any document is a reference; Recruitment stores no bytes.',
  })
  public async recordProfileEntry(
    @Param('candidateId') candidateId: string,
    @Body() body: ProfileEntryBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordProfileEntryCommand>({
        commandName: 'recruitment.record-profile-entry',
        candidateId,
        ...body,
      }),
    );
  }

  @Post(':candidateId/person-link')
  @ApiOperation({ summary: 'Link this candidate to a Person. Explicit, and write-once' })
  @ApiOkResponse({ description: 'The candidate now resolves to that Person.' })
  public async linkPerson(
    @Param('candidateId') candidateId: string,
    @Body() body: LinkPersonBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, LinkCandidateToPersonCommand>({
        commandName: 'recruitment.link-candidate-to-person',
        candidateId,
        ...body,
      }),
    );
  }

  @Post(':candidateId/anonymization')
  @ApiOperation({ summary: 'Remove personal data, keeping the record that they existed' })
  @ApiOkResponse({
    description:
      'Irreversible, separately permissioned, and physically deletes nothing: every reference still resolves and the audit trail still reads.',
  })
  public async anonymize(
    @Param('candidateId') candidateId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AnonymizeCandidateCommand>({
        commandName: 'recruitment.anonymize-candidate',
        candidateId,
        ...body,
      }),
    );
  }
}
