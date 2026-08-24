import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ReturnCustodyCommand } from '../application/custody.use-case.js';
import type { ReadCustodySummary, ReadEmploymentCustody } from '../application/custody-queries.js';
import type { ReadEmploymentClearance } from '../application/clearance-queries.js';

import { ReturnCustodyBody } from './assets.dto.js';
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

  /**
   * Declared before `GET ''` and before any parameterized route, so the literal `summary` segment
   * resolves to this rather than being read as an identifier.
   */
  @Get('summary')
  @ApiOperation({
    summary: 'How much is out across the tenant, and how long the oldest has been out',
  })
  @ApiOkResponse({
    description:
      'A count and two dates. No asset, custody or employment identifier appears, which is what separates it from a tenant-wide listing.',
  })
  public async summary(@Query('asAt') asAt?: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCustodySummary>({
        queryName: 'assets.custody-summary',
        ...(asAt === undefined ? {} : { asAt }),
      }),
    );
  }

  /**
   * A literal segment too, and declared before `GET ''` for the same reason `summary` is.
   */
  @Get('clearance')
  @ApiOperation({ summary: 'What one employment still holds, and why clearance cannot complete' })
  @ApiOkResponse({
    description:
      'Reports persisted facts and changes nothing. `assetsClear` covers company assets only — Offboarding decides whether a person is cleared.',
  })
  public async clearance(
    @Query('employmentId') employmentId: string,
    @Query('asAt') asAt?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadEmploymentClearance>({
        queryName: 'assets.employment-clearance',
        employmentId,
        ...(asAt === undefined ? {} : { asAt }),
      }),
    );
  }

  @Get()
  @ApiOperation({ summary: 'What one employment holds, and what it held before' })
  @ApiOkResponse({
    description:
      'Takes an employment. There is deliberately no tenant-wide custody listing, and the page size is bounded.',
  })
  public async forEmployment(
    @Query('employmentId') employmentId: string,
    @Query('openOnly') openOnly?: string,
    @Query('asAt') asAt?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadEmploymentCustody>({
        queryName: 'assets.employment-custody',
        employmentId,
        ...(openOnly === undefined ? {} : { openOnly: openOnly === 'true' }),
        ...(asAt === undefined ? {} : { asAt }),
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
