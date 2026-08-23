import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IssueCustodyCommand, ReturnCustodyCommand } from '../application/custody.use-case.js';
import type { ReadAssetCustody, ReadEmploymentCustody } from '../application/custody-queries.js';

import { IssueCustodyBody, ReturnCustodyBody } from './assets.dto.js';
import { AssetsDispatcher } from './assets-dispatcher.js';
import { numbered } from './query-numbers.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Custody: who holds an asset, since when, and what came back.
 *
 * Its own controller under the literal `assets/custody` prefix, declared **before** `AssetController`
 * so that `assets/:assetId` cannot swallow it — the same resolution rule the catalogue controller
 * already depends on, and a route test asserts it rather than trusting this comment.
 *
 * **No `PUT`, `PATCH` or `DELETE`.** A custody closes through its own `POST`, and a returned one is
 * immutable at the database from that instant.
 *
 * **No route here transfers, acknowledges, cancels or corrects a custody**, and none takes a tenant or
 * an actor. Each of those is a deferred capability with an open decision behind it.
 */
@ApiTags('assets')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'assets/custody', version: '1' })
export class CustodyController {
  public constructor(private readonly dispatcher: AssetsDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'What one employment holds, and what it held before' })
  @ApiOkResponse({
    description:
      'Takes an employment. There is deliberately no tenant-wide custody listing, and the page size is bounded.',
  })
  public async forEmployment(
    @Query('employmentId') employmentId: string,
    @Query('openOnly') openOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadEmploymentCustody>({
        queryName: 'assets.employment-custody',
        employmentId,
        ...(openOnly === undefined ? {} : { openOnly: openOnly === 'true' }),
        ...numbered('page', page),
        ...numbered('pageSize', pageSize),
      }),
    );
  }

  @Post(':assetCustodyId/return')
  @ApiOperation({ summary: 'Record that an asset came back. The custody becomes immutable' })
  @ApiOkResponse({
    description:
      'A custody that is already returned is refused, and the database refuses it again from any path.',
  })
  public async returnCustody(
    @Param('assetCustodyId') assetCustodyId: string,
    @Body() body: ReturnCustodyBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReturnCustodyCommand>({
        commandName: 'assets.return-custody',
        assetCustodyId,
        ...body,
      }),
    );
  }
}

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
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadAssetCustody>({
        queryName: 'assets.asset-custody',
        assetId,
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
