import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  AmendDocumentTypeCommand,
  DefineDocumentTypeCommand,
} from '../application/document-type.use-case.js';
import type { ListDocumentTypes } from '../application/documents-queries.js';

import { AmendTypeBody, DefineTypeBody } from './documents.dto.js';
import { DocumentsDispatcher } from './documents-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * What a tenant calls a kind of document.
 *
 * Its own controller, declared **before** `DocumentController`: every route here begins with the
 * literal `types`, and Nest resolves by declaration order, so a `:documentId` route registered
 * first would swallow them (the Phase 10 lesson).
 *
 * **Nothing statutory is created here or anywhere.** A passport type, a residency-permit type and a
 * work-permit type are all rows a customer or a country pack writes; this module ships the shape
 * and none of the content (00B, AD-002).
 */
@ApiTags('documents')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'documents/types', version: '1' })
export class DocumentTypeController {
  public constructor(private readonly dispatcher: DocumentsDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The document types this tenant has configured' })
  @ApiOkResponse({
    description:
      'Notice thresholds are configuration. Nothing fires them: no scheduler is verified.',
  })
  public async types(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListDocumentTypes>({ queryName: 'documents.types' }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a kind of document. Nothing statutory is created here' })
  public async defineType(@Body() body: DefineTypeBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineDocumentTypeCommand>({
        commandName: 'documents.define-type',
        ...body,
      }),
    );
  }

  @Post(':documentTypeId')
  @ApiOperation({ summary: 'Amend a type. Its code and permitted owners are not editable' })
  public async amendType(
    @Param('documentTypeId') documentTypeId: string,
    @Body() body: AmendTypeBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendDocumentTypeCommand>({
        commandName: 'documents.amend-type',
        documentTypeId,
        ...body,
      }),
    );
  }
}
