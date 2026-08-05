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
  ChangeUnitStatusCommand,
  CreateUnitCommand,
  RenameUnitCommand,
  ReviseUnitMetadataCommand,
} from '../application/unit.use-case.js';
import type { ListUnits } from '../application/organization-queries.js';

import {
  ChangeUnitStatusBody,
  CreateUnitBody,
  RenameUnitBody,
  ReviseMetadataBody,
} from './organization.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The nodes of the structure.
 *
 * Creating a unit does not place it. A unit that exists but sits nowhere is a real and useful
 * state — a branch approved before the group decides which region owns it — and `POST
 * /units/{id}/placement` on the hierarchy controller is what puts it somewhere.
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'organization', version: '1' })
export class UnitsController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Get('units')
  @ApiOperation({ summary: 'Search units by code or by name in either language' })
  @ApiQuery({ name: 'term', required: false })
  @ApiQuery({ name: 'unitTypeId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ description: 'A page of units.' })
  public async listUnits(
    @Query('term') term?: string,
    @Query('unitTypeId') unitTypeId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.list-units',
        ...(term === undefined ? {} : { term }),
        ...(unitTypeId === undefined ? {} : { unitTypeId }),
        ...(status === undefined ? {} : { status }),
        ...(page === undefined ? {} : { page: Number(page) }),
        ...(size === undefined ? {} : { size: Number(size) }),
      } satisfies ListUnits),
    );
  }

  @Post('units')
  @ApiOperation({ summary: 'Create a unit. Creating does not place it — placement is separate' })
  @ApiOkResponse({ description: 'The created unit.' })
  public async createUnit(@Body() body: CreateUnitBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.create-unit',
        unitTypeId: body.unitTypeId,
        code: body.code,
        name: body.name,
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies CreateUnitCommand),
    );
  }

  @Patch('units/:unitId/name')
  @ApiOperation({ summary: 'Rename a unit, in both languages' })
  @ApiOkResponse({ description: 'The renamed unit.' })
  public async renameUnit(
    @Param('unitId') unitId: string,
    @Body() body: RenameUnitBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.rename-unit',
        unitId,
        name: body.name,
        ...(body.description === undefined ? {} : { description: body.description }),
        expectedVersion: body.expectedVersion,
      } satisfies RenameUnitCommand),
    );
  }

  @Patch('units/:unitId/status')
  @ApiOperation({ summary: 'Move a unit through its lifecycle. Closing never deletes it' })
  @ApiOkResponse({ description: 'The unit.' })
  public async changeStatus(
    @Param('unitId') unitId: string,
    @Body() body: ChangeUnitStatusBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.change-unit-status',
        unitId,
        status: body.status,
        effectiveAt: new Date(body.effectiveAt),
        expectedVersion: body.expectedVersion,
      } satisfies ChangeUnitStatusCommand),
    );
  }

  @Patch('units/:unitId/metadata')
  @ApiOperation({ summary: 'Replace tenant-authored metadata. Stored, never interpreted' })
  @ApiOkResponse({ description: 'The unit.' })
  public async reviseMetadata(
    @Param('unitId') unitId: string,
    @Body() body: ReviseMetadataBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.revise-unit-metadata',
        unitId,
        metadata: body.metadata,
        expectedVersion: body.expectedVersion,
      } satisfies ReviseUnitMetadataCommand),
    );
  }
}
