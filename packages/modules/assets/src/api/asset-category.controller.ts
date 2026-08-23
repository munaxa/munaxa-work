import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  AmendAssetCategoryCommand,
  DefineAssetCategoryCommand,
} from '../application/asset-category.use-case.js';
import type { ListAssetCategories } from '../application/assets-queries.js';

import { AmendAssetCategoryBody, DefineAssetCategoryBody } from './assets.dto.js';
import { AssetsDispatcher } from './assets-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The tenant's asset catalogue.
 *
 * Its own controller, declared **before** `AssetController`: every route here begins with the literal
 * `categories`, and Nest resolves by declaration order, so an `:assetId` route registered first would
 * swallow them (the Phase 10 lesson, and the Phase 5.2 one). A route test asserts the resolution
 * rather than trusting this comment.
 *
 * **Nothing ships in the catalogue.** Every entry is a row a tenant writes; no asset type,
 * valuation rule or depreciation schedule ships with this product (AD-002).
 *
 * **No `PUT`, `PATCH` or `DELETE`.** Amendment is a `POST` to the resource, matching the Relations
 * catalogue's own `amend`; entries leave service by deactivation.
 */
@ApiTags('assets')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'assets/categories', version: '1' })
export class AssetCategoryController {
  public constructor(private readonly dispatcher: AssetsDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The asset types this tenant has configured' })
  @ApiOkResponse({
    description:
      'Ordered by sequence, then code. No condition scale and no valuation basis: neither is built.',
  })
  public async categories(@Query('includeInactive') includeInactive?: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListAssetCategories>({
        queryName: 'assets.categories',
        includeInactive: includeInactive === 'true',
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a kind of asset. Nothing ships in the catalogue' })
  public async defineCategory(@Body() body: DefineAssetCategoryBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineAssetCategoryCommand>({
        commandName: 'assets.define-category',
        ...body,
      }),
    );
  }

  @Post(':assetCategoryId')
  @ApiOperation({ summary: 'Amend a type. Its code is not editable' })
  public async amendCategory(
    @Param('assetCategoryId') assetCategoryId: string,
    @Body() body: AmendAssetCategoryBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendAssetCategoryCommand>({
        commandName: 'assets.amend-category',
        assetCategoryId,
        ...body,
      }),
    );
  }
}
