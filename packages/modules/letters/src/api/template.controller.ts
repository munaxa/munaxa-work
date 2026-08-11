import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  AmendVersionCommand,
  DefineTemplateCommand,
  DraftVersionCommand,
  MoveVersionCommand,
} from '../application/template.use-case.js';
import type { ListTemplates, ReadTemplate } from '../application/letters-queries.js';

import {
  AmendVersionBody,
  DefineTemplateBody,
  MoveVersionBody,
  VersionBody,
} from './letters.dto.js';
import { LettersDispatcher } from './letters-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Authoring the letters a tenant may issue.
 *
 * Its own controller under the literal `letters/templates` prefix, registered **before** the
 * controllers carrying `:letterRequestId` and `:issuedLetterId` segments. Nest resolves by
 * declaration order, and a parameter route registered first would swallow these (the Phase 10
 * lesson).
 *
 * **Nothing is hardcoded.** An employment certificate, a salary certificate, an experience letter
 * and an embassy letter are all rows a tenant or a country pack writes; there is no endpoint per
 * letter type and no letter type anywhere in this module's code (5.1 AD-001).
 */
@ApiTags('letters')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'letters/templates', version: '1' })
export class LetterTemplateController {
  public constructor(private readonly dispatcher: LettersDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The letter templates this tenant has authored' })
  public async list(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListTemplates>({ queryName: 'letters.templates' }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a letter a tenant may issue' })
  public async define(@Body() body: DefineTemplateBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineTemplateCommand>({
        commandName: 'letters.define-template',
        ...body,
      }),
    );
  }

  @Get(':letterTemplateId')
  @ApiOperation({ summary: 'One template and every version of what it says' })
  @ApiOkResponse({
    description:
      'A version reports whether it is still editable. The freeze is caused by issuance, not by ' +
      'publication.',
  })
  public async read(@Param('letterTemplateId') letterTemplateId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadTemplate>({
        queryName: 'letters.read-template',
        letterTemplateId,
      }),
    );
  }

  @Post(':letterTemplateId/versions')
  @ApiOperation({ summary: 'Draft a new version. Both languages are required' })
  @ApiOkResponse({
    description:
      'Every placeholder the body uses must be a declared variable, and a variable is a name ' +
      'rather than an expression. Substitution is a lookup; nothing evaluates.',
  })
  public async draft(
    @Param('letterTemplateId') letterTemplateId: string,
    @Body() body: VersionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DraftVersionCommand>({
        commandName: 'letters.draft-version',
        letterTemplateId,
        ...body,
      }),
    );
  }

  @Post('versions/:letterTemplateVersionId')
  @ApiOperation({ summary: 'Amend a version that has issued nothing' })
  @ApiOkResponse({
    description:
      'Refused once the version has issued a letter: editing it would silently change what a ' +
      'historical letter claims to have been generated from.',
  })
  public async amend(
    @Param('letterTemplateVersionId') letterTemplateVersionId: string,
    @Body() body: AmendVersionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendVersionCommand>({
        commandName: 'letters.amend-version',
        letterTemplateVersionId,
        ...body,
      }),
    );
  }

  @Post('versions/:letterTemplateVersionId/status')
  @ApiOperation({ summary: 'Publish or retire a version' })
  @ApiOkResponse({
    description:
      'Retiring stops new letters. Letters already issued from the version are untouched — that ' +
      'is the difference between withdrawing a letter type and rewriting history.',
  })
  public async move(
    @Param('letterTemplateVersionId') letterTemplateVersionId: string,
    @Body() body: MoveVersionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveVersionCommand>({
        commandName: 'letters.move-version',
        letterTemplateVersionId,
        ...body,
      }),
    );
  }
}
