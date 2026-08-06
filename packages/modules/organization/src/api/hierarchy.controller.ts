import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type { DetachUnitCommand, PlaceUnitCommand } from '../application/hierarchy.use-case.js';
import type {
  ListPlacementHistory,
  ReadHierarchy,
  ReadUnitAncestry,
  ResolveGoverningLegalEntity,
} from '../application/structure-queries.js';

import { DetachUnitBody, PlaceUnitBody } from './organization.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The shape of the organization, and the history of how it got that way.
 *
 * Every read here takes `asOf`, defaulting to now. That is the phase's central claim made
 * usable: "what did this structure look like on this date" is the ordinary way this module is
 * read, and today's chart is just the case where the date is today.
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'organization', version: '1' })
export class HierarchyController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Get('hierarchy')
  @ApiOperation({ summary: 'The structure as it stood on a date. Unlimited depth (AD-003)' })
  @ApiQuery({ name: 'asOf', required: false, description: 'Defaults to now.' })
  @ApiQuery({ name: 'rootUnitId', required: false, description: 'Restricts to one subtree.' })
  @ApiOkResponse({ description: 'The tree, plus any units that existed but were unplaced.' })
  public async hierarchy(
    @Query('asOf') asOf?: string,
    @Query('rootUnitId') rootUnitId?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.hierarchy',
        ...(asOf === undefined ? {} : { asOf: new Date(asOf) }),
        ...(rootUnitId === undefined ? {} : { rootUnitId }),
      } satisfies ReadHierarchy),
    );
  }

  @Get('units/:unitId/ancestry')
  @ApiOperation({ summary: "A unit's chain up to its root, as it stood on a date" })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiOkResponse({ description: 'The parent and the ancestor chain, nearest first.' })
  public async ancestry(
    @Param('unitId') unitId: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.unit-ancestry',
        unitId,
        ...(asOf === undefined ? {} : { asOf: new Date(asOf) }),
      } satisfies ReadUnitAncestry),
    );
  }

  @Get('units/:unitId/placements')
  @ApiOperation({ summary: 'Every period this unit has sat somewhere. History is never rewritten' })
  @ApiOkResponse({ description: 'The placement periods, oldest first.' })
  public async placements(@Param('unitId') unitId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.placement-history',
        unitId,
      } satisfies ListPlacementHistory),
    );
  }

  @Get('units/:unitId/governing-legal-entity')
  @ApiOperation({
    summary: "Which legal entity — and therefore which country's law — governs this unit",
    description:
      'Walks up to the nearest registration. An employment resolves its country pack from ' +
      'here and never from the tenant, so a tenant may operate several countries at once (00B).',
  })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiOkResponse({ description: 'The governing entity, or none, and the chain walked to it.' })
  public async governingLegalEntity(
    @Param('unitId') unitId: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.governing-legal-entity',
        unitId,
        ...(asOf === undefined ? {} : { asOf: new Date(asOf) }),
      } satisfies ResolveGoverningLegalEntity),
    );
  }

  @Post('units/:unitId/placement')
  @ApiOperation({
    summary: 'Place a unit under a parent from a date. A move supersedes, never overwrites',
  })
  @ApiOkResponse({ description: 'The new placement period.' })
  public async place(
    @Param('unitId') unitId: string,
    @Body() body: PlaceUnitBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.place-unit',
        unitId,
        ...(body.parentUnitId === undefined ? {} : { parentUnitId: body.parentUnitId }),
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies PlaceUnitCommand),
    );
  }

  @Delete('units/:unitId/placement')
  @ApiOperation({ summary: 'End the open placement. The unit survives, unplaced' })
  @ApiOkResponse({ description: 'The closed placement period.' })
  public async detach(
    @Param('unitId') unitId: string,
    @Body() body: DetachUnitBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.detach-unit',
        unitId,
        effectiveTo: new Date(body.effectiveTo),
        expectedVersion: body.expectedVersion,
      } satisfies DetachUnitCommand),
    );
  }
}
