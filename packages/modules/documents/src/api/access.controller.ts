import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  AuthorizeDownloadCommand,
  PlaceLegalHoldCommand,
  VerifyDocumentCommand,
} from '../application/verification.use-case.js';

import { AuthorizeDownloadBody, LegalHoldBody, VerifyBody } from './documents.dto.js';
import { DocumentsDispatcher } from './documents-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Verification, legal hold, and the one route that reaches toward storage.
 *
 * Separate from the register controller because these three are the operations with teeth:
 * verifying a document is a named human accepting responsibility for it, a legal hold refuses
 * archiving and deletion, and a download authorization is the only path in this product that would
 * produce a link to somebody's passport scan.
 *
 * **`POST :documentId/download` is a command, not a `GET`.** It writes an access event, and a read
 * that writes is a command; routing it as a `GET` would put a write on the read path, make it
 * cacheable, and put the document identifier in a proxy log. It is also what makes the trail
 * complete rather than optional.
 *
 * **It never returns a file, and today it never returns a URL.** No storage adapter exists in this
 * repository, so the response is `available: false` with no `url`. That is reported honestly rather
 * than as a failure, and never as a fabricated link.
 */
@ApiTags('documents')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'documents', version: '1' })
export class DocumentAccessController {
  public constructor(private readonly dispatcher: DocumentsDispatcher) {}

  @Post(':documentId/verification')
  @ApiOperation({ summary: 'Decide whether a version is what it claims to be' })
  @ApiOkResponse({
    description:
      'The decider comes from the authenticated context, never from the body. One decision per ' +
      'version; a second is refused.',
  })
  public async verify(
    @Param('documentId') documentId: string,
    @Body() body: VerifyBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, VerifyDocumentCommand>({
        commandName: 'documents.verify',
        documentId,
        ...body,
      }),
    );
  }

  @Post(':documentId/legal-hold')
  @ApiOperation({ summary: 'Place or lift a legal hold. Placing one requires a stated reason' })
  @ApiOkResponse({
    description:
      'A hold refuses archiving and refuses replacement. This module defines no retention period: ' +
      'the retention code is opaque and is never interpreted here.',
  })
  public async legalHold(
    @Param('documentId') documentId: string,
    @Body() body: LegalHoldBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PlaceLegalHoldCommand>({
        commandName: 'documents.legal-hold',
        documentId,
        ...body,
      }),
    );
  }

  @Post(':documentId/download')
  @ApiOperation({ summary: 'Authorize a download. Returns a short-lived URL, or says it cannot' })
  @ApiOkResponse({
    description:
      'available is false and url is absent wherever no storage adapter is wired, which is ' +
      'everywhere in this repository today. A consumer must branch on available rather than ' +
      'assume a URL. The attempt is recorded either way.',
  })
  public async authorizeDownload(
    @Param('documentId') documentId: string,
    @Body() body: AuthorizeDownloadBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AuthorizeDownloadCommand>({
        commandName: 'documents.authorize-download',
        documentId,
        ...body,
      }),
    );
  }
}
