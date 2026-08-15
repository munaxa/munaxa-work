import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  IssueCertificationCommand,
  RevokeCertificationCommand,
} from '../application/certification.use-case.js';
import type { SearchCertifications } from '../application/learning-record-queries.js';
import type { CertificationSource } from '../domain/learning-vocabulary.js';

import { ReasonedBody } from './learning.dto.js';
import { IssueCertificationBody } from './learner.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { noticeDays, optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What somebody holds, and whether it is still worth anything today.
 *
 * **Validity is derived on read and no column holds it.** `asOf` names the day the question is
 * asked about and is echoed in the answer; `noticeDays` says how far ahead counts as expiring, and
 * `0` asks a plain yes-or-no question. The alternative — a stored flag — would need something to
 * move it overnight, and `JobPort` has no adapter anywhere in this repository: a forklift licence
 * that lapsed in March would still read `valid` in June (ADR-0070).
 *
 * **There is no supersede route.** Superseding is what issuing the next certificate does, through
 * `supersedesCertificationId` on the issue body. A route that superseded without issuing would take
 * a qualification away and put nothing in its place.
 *
 * **Revoking has its own permission and demands a reason.** Issuing is routine; taking a
 * qualification away from somebody is not, and it needs a name against it — which comes from the
 * authenticated context, never from the body.
 *
 * **Issuing is idempotent per completion.** A repeat against the same enrolment returns the
 * certificate that already exists rather than a second one, arbitrated by a unique index rather
 * than by a read-then-write, so a retried request cannot leave somebody holding two.
 *
 * `evidenceDocumentId` is a **reference, confirmed to exist through Documents' published query**.
 * Nothing here uploads, stores, downloads or signs a URL for anything; binary storage is
 * `NOT VERIFIED`, and a route that implied otherwise would promise a download that never arrives.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/certifications', version: '1' })
export class LearningCertificationController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search certifications with validity derived against a stated day' })
  @ApiOkResponse({
    description:
      'A caller with no resolvable scope receives an empty page. `asOf` is echoed so a screen can ' +
      'say what day it answered for.',
  })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchCertifications>({
        queryName: 'learning.search-certifications',
        ...paged(query),
        noticeDays: noticeDays(query),
        ...optional(query, ['employmentId', 'courseId', 'status', 'validUntilOnOrBefore', 'asOf']),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Issue a certificate. Idempotent per completion; supersedes by field' })
  public async issue(@Body() body: IssueCertificationBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, IssueCertificationCommand>({
        commandName: 'learning.issue-certification',
        employmentId: body.employmentId,
        title: body.title,
        source: body.source as CertificationSource,
        issuedOn: body.issuedOn,
        ...present({
          enrolmentId: body.enrolmentId,
          courseId: body.courseId,
          validUntil: body.validUntil,
          supersedesCertificationId: body.supersedesCertificationId,
          evidenceDocumentId: body.evidenceDocumentId,
        }),
      }),
    );
  }

  @Post(':certificationId/revocation')
  @ApiOperation({ summary: 'Revoke a certificate. Its own permission, and a reason' })
  public async revoke(
    @Param('certificationId') certificationId: string,
    @Body() body: ReasonedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RevokeCertificationCommand>({
        commandName: 'learning.revoke-certification',
        certificationId,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
      }),
    );
  }
}
