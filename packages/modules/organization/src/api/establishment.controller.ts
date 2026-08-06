import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type {
  ApproveEstablishmentCommand,
  SetEstablishmentCommand,
} from '../application/establishment.use-case.js';
import type { ReadEstablishmentPosture } from '../application/structure-queries.js';

import { VersionedBody } from './organization.dto.js';
import { SetEstablishmentBody } from './planning.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Manpower planning: budgeted headcount per position per unit.
 *
 * Organization owns the *budgeted* number and never the filled one. Filled counts employment
 * assignments, Employment owns those, and counting them here would be the duplicated ownership
 * the master instructions exist to prevent (AD-002). Until Phase 5 exists there are no
 * assignments, so filled is zero — arithmetic on an empty set, not a placeholder.
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'organization', version: '1' })
export class EstablishmentController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Post('establishment')
  @ApiOperation({
    summary: 'Set budgeted headcount for a position in a unit, from a date',
    description: "Supersedes rather than overwrites: last year's approved figure keeps its answer.",
  })
  @ApiOkResponse({ description: 'The establishment line, in draft.' })
  public async setEstablishment(@Body() body: SetEstablishmentBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.set-establishment',
        positionId: body.positionId,
        unitId: body.unitId,
        budgetedHeadcount: body.budgetedHeadcount,
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies SetEstablishmentCommand),
    );
  }

  @Patch('establishment/:establishmentId/approve')
  @ApiOperation({ summary: 'Approve a line. A requisition is validated against the approved one' })
  @ApiOkResponse({ description: 'The approved line.' })
  public async approve(
    @Param('establishmentId') establishmentId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.approve-establishment',
        establishmentId,
        expectedVersion: body.expectedVersion,
      } satisfies ApproveEstablishmentCommand),
    );
  }

  @Get('units/:unitId/establishment')
  @ApiOperation({
    summary: 'Approved, filled and vacant for each position budgeted in a unit',
    description:
      "Filled is supplied by Employment's assignment events and is zero until Phase 5 exists. " +
      'Organization never counts employees itself.',
  })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiOkResponse({ description: 'The posture per position.' })
  public async posture(
    @Param('unitId') unitId: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.establishment-posture',
        unitId,
        ...(asOf === undefined ? {} : { asOf: new Date(asOf) }),
      } satisfies ReadEstablishmentPosture),
    );
  }
}
