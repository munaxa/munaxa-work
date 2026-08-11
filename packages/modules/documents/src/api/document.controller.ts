import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { CreateDocumentCommand } from '../application/document.use-case.js';
import type {
  ReadDocument,
  ReadDocumentAudit,
  ReadReconciliation,
  SearchDocuments,
} from '../application/documents-queries.js';

import { CreateDocumentBody } from './documents.dto.js';
import { DocumentsDispatcher } from './documents-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The document register: searching, filing and reading.
 *
 * `reconciliation` is declared before the `:documentId` routes and the type routes live in their
 * own controller registered ahead of this one. Route ordering is load-bearing rather than cosmetic:
 * Nest resolves by declaration order, and a `:documentId` declared before a literal segment would
 * swallow it (the Phase 10 lesson).
 *
 * Authorization is **not** decided here. Each application handler declares the permission it
 * requires and the kernel's pipeline enforces it before the handler runs, so a controller cannot
 * accidentally widen access by forgetting a guard — and cannot narrow it either.
 *
 * **No route on this controller accepts or returns file content.** There is no upload endpoint and
 * no download endpoint; obtaining the bytes is a separate, authorized, audited operation on the
 * access controller, and today it answers that the capability is unavailable.
 */
@ApiTags('documents')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'documents', version: '1' })
export class DocumentController {
  public constructor(private readonly dispatcher: DocumentsDispatcher) {}

  @Get('reconciliation')
  @ApiOperation({ summary: 'What reconciliation found. It reports; it repairs nothing' })
  @ApiOkResponse({
    description:
      'Storage checks are absent and cannot be here: both require reading bytes, and no storage ' +
      'adapter exists.',
  })
  public async reconciliation(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadReconciliation>({
        queryName: 'documents.reconciliation',
      }),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Search the register. Bounded, and confidentiality-aware' })
  @ApiOkResponse({
    description:
      'A caller without document.read-sensitive does not receive confidential documents and does ' +
      'not learn how many were withheld — a count is itself a disclosure.',
  })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    const page = paged(query);

    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchDocuments>({
        queryName: 'documents.search',
        ...page,
        ...optional(query, [
          'ownerType',
          'ownerId',
          'documentTypeId',
          'status',
          'verificationState',
          'expiringOnOrBefore',
        ]),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'File a document. The owner is confirmed before the row exists' })
  public async create(@Body() body: CreateDocumentBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateDocumentCommand>({
        commandName: 'documents.create-document',
        ...body,
      }),
    );
  }

  @Get(':documentId')
  @ApiOperation({ summary: 'One document, its versions and its verification history' })
  @ApiOkResponse({ description: 'The read is recorded in the access trail.' })
  public async read(@Param('documentId') documentId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDocument>({
        queryName: 'documents.read-document',
        documentId,
      }),
    );
  }

  @Get(':documentId/audit')
  @ApiOperation({ summary: 'Who has reached this document. Behind its own permission' })
  public async audit(
    @Param('documentId') documentId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadDocumentAudit>({
        queryName: 'documents.audit',
        documentId,
        ...paged(query),
      }),
    );
  }
}

/**
 * The filters a caller actually supplied.
 *
 * A key present with `undefined` is not the same as absent under `exactOptionalPropertyTypes`, and
 * a filter that arrived as `undefined` would narrow a search to rows whose column is literally
 * null. Dropping them here is what keeps an empty query string meaning "everything".
 */
const optional = (
  query: Record<string, string | undefined>,
  names: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    names
      .map((name) => [name, query[name]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
