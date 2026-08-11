import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AddVersionCommand, MoveDocumentCommand } from '../application/document.use-case.js';

import { AddVersionBody, MoveDocumentBody } from './documents.dto.js';
import { DocumentsDispatcher } from './documents-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * A document's versions, and where it sits in its lifecycle.
 *
 * Both routes carry a `:documentId` segment, so this controller is registered after
 * `DocumentController` — Nest resolves by declaration order, and these would otherwise be
 * indistinguishable from a document read.
 *
 * **Neither route carries file content.** Adding a version records a reference, a declared type, a
 * size and a hash the caller supplied; this module never sees the bytes, never hashes them and
 * never confirms that the hash describes them.
 */
@ApiTags('documents')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'documents', version: '1' })
export class DocumentVersionController {
  public constructor(private readonly dispatcher: DocumentsDispatcher) {}

  @Post(':documentId/versions')
  @ApiOperation({ summary: 'Add a version. **Carries no file content** — only its reference' })
  @ApiOkResponse({
    description:
      'Duplicate content across the tenant is permitted and surfaced, never refused: two ' +
      'employees legitimately hold the same blank form.',
  })
  public async addVersion(
    @Param('documentId') documentId: string,
    @Body() body: AddVersionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AddVersionCommand>({
        commandName: 'documents.add-version',
        documentId,
        ...body,
      }),
    );
  }

  @Post(':documentId/status')
  @ApiOperation({ summary: 'Archive or restore. There is no permanent deletion in this phase' })
  public async move(
    @Param('documentId') documentId: string,
    @Body() body: MoveDocumentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveDocumentCommand>({
        commandName: 'documents.move-document',
        documentId,
        ...body,
      }),
    );
  }
}
