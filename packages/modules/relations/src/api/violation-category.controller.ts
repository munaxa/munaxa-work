import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  AmendViolationCategoryCommand,
  DefineViolationCategoryCommand,
} from '../application/violation-category.use-case.js';
import type { ListViolationCategories } from '../application/relations-queries.js';

import { AmendCategoryBody, DefineCategoryBody } from './relations.dto.js';
import { RelationsDispatcher } from './relations-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The tenant's violation catalogue.
 *
 * Its own controller, declared **before** `ViolationController`: every route here begins with the
 * literal `categories`, and Nest resolves by declaration order, so a `:violationId` route registered
 * first would swallow them (the Phase 10 lesson).
 *
 * **Nothing statutory is created here or anywhere.** Every entry is a row a tenant writes; no
 * offence, penalty or jurisdiction ships with this product (AD-002).
 *
 * **Catalogue reads are not audited**, and that is deliberate rather than an omission: a catalogue
 * is the list of words a policy is written in and names nobody. Reads of a *violation* are audited —
 * see `ViolationController`.
 */
@ApiTags('relations')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'relations/categories', version: '1' })
export class ViolationCategoryController {
  public constructor(private readonly dispatcher: RelationsDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The violation types this tenant has configured' })
  @ApiOkResponse({
    description:
      'Ordered by sequence, then code. No labour-law validation is applied: country packs arrive in Phase 11.1.',
  })
  public async categories(@Query('includeInactive') includeInactive?: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListViolationCategories>({
        queryName: 'relations.categories',
        includeInactive: includeInactive === 'true',
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a kind of violation. Nothing statutory is created here' })
  public async defineCategory(@Body() body: DefineCategoryBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineViolationCategoryCommand>({
        commandName: 'relations.define-category',
        ...body,
      }),
    );
  }

  @Post(':violationCategoryId')
  @ApiOperation({ summary: 'Amend a type. Its code and source are not editable' })
  public async amendCategory(
    @Param('violationCategoryId') violationCategoryId: string,
    @Body() body: AmendCategoryBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendViolationCategoryCommand>({
        commandName: 'relations.amend-category',
        violationCategoryId,
        ...body,
      }),
    );
  }
}
