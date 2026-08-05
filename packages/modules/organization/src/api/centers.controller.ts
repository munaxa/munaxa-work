import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  CloseCostCenter,
  CloseProfitCenter,
  OpenCostCenter,
  OpenProfitCenter,
} from '../application/financial-center.use-case.js';

import { CloseEffectiveBody, OpenCenterBody } from './organization.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Cost and profit centres — organizational reference data finance recognizes (AD-007).
 *
 * Two paths rather than one with a `kind` field, because the permissions differ: in most finance
 * functions the person who maintains cost centres is not the person who maintains profit
 * centres, and a single endpoint could only be guarded by one permission.
 *
 * There is no budget on either. Financial ownership belongs to the finance system this product
 * integrates with; a centre that carried a budget would be this product quietly becoming a
 * general ledger.
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'organization', version: '1' })
export class CentersController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Post('cost-centers')
  @ApiOperation({ summary: 'Open a cost centre' })
  @ApiOkResponse({ description: 'The centre.' })
  public async openCost(@Body() body: OpenCenterBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.open-cost-center',
        ...openFrom(body),
      } satisfies OpenCostCenter),
    );
  }

  @Patch('cost-centers/:centerId/close')
  @ApiOperation({ summary: 'Close a cost centre. Postings against it still resolve' })
  @ApiOkResponse({ description: 'The closed centre.' })
  public async closeCost(
    @Param('centerId') centerId: string,
    @Body() body: CloseEffectiveBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.close-cost-center',
        centerId,
        effectiveTo: new Date(body.effectiveTo),
        expectedVersion: body.expectedVersion,
      } satisfies CloseCostCenter),
    );
  }

  @Post('profit-centers')
  @ApiOperation({ summary: 'Open a profit centre' })
  @ApiOkResponse({ description: 'The centre.' })
  public async openProfit(@Body() body: OpenCenterBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.open-profit-center',
        ...openFrom(body),
      } satisfies OpenProfitCenter),
    );
  }

  @Patch('profit-centers/:centerId/close')
  @ApiOperation({ summary: 'Close a profit centre' })
  @ApiOkResponse({ description: 'The closed centre.' })
  public async closeProfit(
    @Param('centerId') centerId: string,
    @Body() body: CloseEffectiveBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.close-profit-center',
        centerId,
        effectiveTo: new Date(body.effectiveTo),
        expectedVersion: body.expectedVersion,
      } satisfies CloseProfitCenter),
    );
  }
}

/** The half of the command that is identical for both kinds. */
const openFrom = (
  body: OpenCenterBody,
): {
  code: string;
  name: Record<string, string>;
  unitId?: string;
  metadata?: Record<string, string>;
  effectiveFrom: Date;
} => ({
  code: body.code,
  name: body.name,
  ...(body.unitId === undefined ? {} : { unitId: body.unitId }),
  ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
  effectiveFrom: new Date(body.effectiveFrom),
});
