import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  AmendAssetCommand,
  ChangeAssetStatusCommand,
  RegisterAssetCommand,
} from '../application/asset.use-case.js';
import type { ReadAsset, SearchAssets } from '../application/assets-queries.js';

import { AmendAssetBody, ChangeAssetStatusBody, RegisterAssetBody } from './assets.dto.js';
import { AssetsDispatcher } from './assets-dispatcher.js';
import { numbered } from './query-numbers.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The inventory: the individual items the company owns.
 *
 * Declared **after** `AssetCategoryController`, and its own collection and create routes are declared
 * before the `:assetId` route, so nothing here shadows the literal `assets/categories` prefix. A route
 * test asserts that rather than trusting this comment.
 *
 * **No `PUT`, `PATCH` or `DELETE`.** An amendment is a `POST` to the resource and a status change is
 * a `POST` to a sub-resource; an asset leaves service by retirement, never by deletion.
 *
 * **No route here issues, returns or acknowledges anything**, and none names an employment or a
 * person. Custody has its own controllers, behind its own permissions, so reading the inventory never
 * implies reading who holds what.
 */
@ApiTags('assets')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'assets', version: '1' })
export class AssetController {
  public constructor(private readonly dispatcher: AssetsDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The inventory, narrowed and paged' })
  @ApiOkResponse({
    description:
      'Ordered by asset tag. Filters are optional; a tenant is never one of them, and the page size is bounded.',
  })
  public async search(
    @Query('assetCategoryId') assetCategoryId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchAssets>({
        queryName: 'assets.search-assets',
        ...(assetCategoryId === undefined ? {} : { assetCategoryId }),
        ...(status === undefined ? {} : { status }),
        ...numbered('page', page),
        ...numbered('pageSize', pageSize),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Register an item. It starts registered; the caller does not choose' })
  public async register(@Body() body: RegisterAssetBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RegisterAssetCommand>({
        commandName: 'assets.register-asset',
        ...body,
      }),
    );
  }

  @Get(':assetId')
  @ApiOperation({ summary: 'One item. Another tenant’s identifier answers as not found' })
  public async read(@Param('assetId') assetId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadAsset>({
        queryName: 'assets.read-asset',
        assetId,
      }),
    );
  }

  @Post(':assetId')
  @ApiOperation({ summary: 'Correct what is recorded. Category, tag and status are not editable' })
  public async amend(
    @Param('assetId') assetId: string,
    @Body() body: AmendAssetBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendAssetCommand>({
        commandName: 'assets.amend-asset',
        assetId,
        ...body,
      }),
    );
  }

  @Post(':assetId/status')
  @ApiOperation({ summary: 'Move the item through the in-service lifecycle. Retired is terminal' })
  public async changeStatus(
    @Param('assetId') assetId: string,
    @Body() body: ChangeAssetStatusBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ChangeAssetStatusCommand>({
        commandName: 'assets.change-asset-status',
        assetId,
        ...body,
      }),
    );
  }
}
