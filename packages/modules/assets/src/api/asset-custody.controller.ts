import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IssueCustodyCommand } from '../application/custody.use-case.js';
import type { ReadAssetCustody } from '../application/custody-queries.js';

import { IssueCustodyBody } from './assets.dto.js';
import { AssetsDispatcher } from './assets-dispatcher.js';
import { numbered } from './query-numbers.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The custody of one asset — issuing it, and reading who holds it.
 *
 * These two live under `assets/:assetId/custody` because the asset is the subject, and they are
 * declared on their own controller so the literal `assets/custody` prefix above stays unshadowed.
 */
@ApiTags('assets')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'assets', version: '1' })
export class AssetCustodyController {
  public constructor(private readonly dispatcher: AssetsDispatcher) {}

  @Get(':assetId/custody')
  @ApiOperation({ summary: 'Who holds this asset now, and who held it before' })
  @ApiOkResponse({
    description:
      'The current holder is the open custody, derived rather than stored. Its absence means nobody holds the asset.',
  })
  public async forAsset(
    @Param('assetId') assetId: string,
    @Query('asAt') asAt?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadAssetCustody>({
        queryName: 'assets.asset-custody',
        assetId,
        ...(asAt === undefined ? {} : { asAt }),
        ...numbered('page', page),
        ...numbered('pageSize', pageSize),
      }),
    );
  }

  @Post(':assetId/custody')
  @ApiOperation({ summary: 'Issue an asset to an employment. The asset must be available' })
  @ApiOkResponse({
    description:
      'Refused if the asset is already held, is not available, or the employment does not exist in this tenant.',
  })
  public async issue(
    @Param('assetId') assetId: string,
    @Body() body: IssueCustodyBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, IssueCustodyCommand>({
        commandName: 'assets.issue-custody',
        assetId,
        ...body,
      }),
    );
  }
}
