import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  DefineUnitTypeCommand,
  RetireUnitTypeCommand,
} from '../application/unit-type.use-case.js';
import type { ListUnitTypes } from '../application/organization-queries.js';

import { DefineUnitTypeBody, VersionedBody } from './organization.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The levels of this tenant's hierarchy.
 *
 * There is no endpoint here that installs the nine levels the specification names. A tenant
 * defines the levels it has, and the nine are offered as data from
 * `GET /organization/standard-unit-types` for an administrator to adopt or ignore — which is
 * what makes unlimited depth true rather than claimed (ADR-0034).
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'organization', version: '1' })
export class UnitTypesController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Get('unit-types')
  @ApiOperation({ summary: "The levels of this tenant's hierarchy. Tenant data, not ours" })
  @ApiOkResponse({ description: 'Every unit type, in display order.' })
  public async listUnitTypes(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.list-unit-types',
      } satisfies ListUnitTypes),
    );
  }

  @Post('unit-types')
  @ApiOperation({
    summary: 'Define a level. Nine are offered as a starting set; none is installed',
  })
  @ApiOkResponse({ description: 'The unit type.' })
  public async defineUnitType(@Body() body: DefineUnitTypeBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.define-unit-type',
        code: body.code,
        name: body.name,
        ordinal: body.ordinal,
        ...(body.allowedParentCodes === undefined
          ? {}
          : { allowedParentCodes: body.allowedParentCodes }),
        ...(body.allowedAtRoot === undefined ? {} : { allowedAtRoot: body.allowedAtRoot }),
        ...(body.carriesLegalEntity === undefined
          ? {}
          : { carriesLegalEntity: body.carriesLegalEntity }),
      } satisfies DefineUnitTypeCommand),
    );
  }

  @Patch('unit-types/:unitTypeId/retire')
  @ApiOperation({ summary: 'Retire a level. Units already of this type keep it' })
  @ApiOkResponse({ description: 'The retired unit type.' })
  public async retireUnitType(
    @Param('unitTypeId') unitTypeId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.retire-unit-type',
        unitTypeId,
        expectedVersion: body.expectedVersion,
      } satisfies RetireUnitTypeCommand),
    );
  }
}
