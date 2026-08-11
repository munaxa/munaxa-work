import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { HireCandidateCommand } from '../application/hire.use-case.js';
import type { ImportCandidatesCommand } from '../application/transfer.use-case.js';
import type { ExportRecruitment } from '../application/transfer.use-case.js';

import { ImportCandidatesBody } from './candidate.dto.js';
import { HireCandidateBody } from './offer.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The hire, and moving a candidate pool in or out.
 *
 * **Hiring is the single act that reaches into the master registry of human identity.** It is held
 * by fewest people, and — the point of ADR-0043 — it does *not* require the caller to also hold
 * `people.person.manage`: the module holds the narrow permission for the duration of the operation,
 * under a grant that is tenant-scoped, auditable and observable.
 *
 * **It is safe to send twice.** The hire is a saga across three transactions (ADR-0046), and
 * repeating the command is the *supported* recovery path: each step recognises what it already did.
 * A stopped hire leaves the application not `hired`, carrying the state it reached — which is what
 * makes a partial transition a query rather than a mystery.
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such application in this tenant.' })
@Controller({ path: 'recruitment', version: '1' })
export class HireController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Post('applications/:applicationId/hire')
  @ApiOperation({ summary: 'Turn an accepted offer into a Person and an Employment' })
  @ApiOkResponse({ description: 'The person, the employment, and the state the saga reached.' })
  @ApiConflictResponse({
    description:
      'No accepted offer, the requisition’s headcount is exhausted, the candidate matches several people, or a step did not complete. In every case the application is not left looking hired.',
  })
  public async hire(
    @Param('applicationId') applicationId: string,
    @Body() body: HireCandidateBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, HireCandidateCommand>({
        commandName: 'recruitment.hire-candidate',
        applicationId,
        ...body,
      }),
    );
  }

  @Post('candidates/import')
  @ApiOperation({ summary: 'Import candidates by sending the same command a recruiter would' })
  @ApiOkResponse({
    description:
      'Created, skipped and failed rows. A duplicate address is skipped rather than failed, so a file that stopped part way can be sent again.',
  })
  @ApiConflictResponse({ description: 'More rows than one synchronous request will carry.' })
  public async importCandidates(@Body() body: ImportCandidatesBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ImportCandidatesCommand>({
        commandName: 'recruitment.import-candidates',
        rows: body.rows,
      }),
    );
  }

  @Get('export')
  @ApiOperation({ summary: 'The candidate register and every application' })
  @ApiOkResponse({
    description:
      'Permissioned separately from reading and held by fewer people: every row is personal data about somebody who does not work here.',
  })
  public async exportAll(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ExportRecruitment>({ queryName: 'recruitment.export' }),
    );
  }
}
