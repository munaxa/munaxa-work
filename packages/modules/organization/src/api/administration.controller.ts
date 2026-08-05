import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ReadTenantSettings } from '../application/organization-queries.js';
import type { ConfigureTenantSettingsCommand } from '../application/tenant-settings.use-case.js';
import type { ImportStructure } from '../application/transfer.use-case.js';
import type { ExportStructure } from '../application/export.use-case.js';
import { STANDARD_UNIT_TYPES } from '../contracts/standard-unit-types.js';

import { ConfigureTenantSettingsBody, ImportStructureBody } from './planning.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Tenant configuration, and moving a whole structure in or out.
 *
 * `PUT /tenant-settings` is the endpoint that closes the Phase 2 debt from the outside: before
 * it, a tenant's language and calendar were the deployment's environment variables and there was
 * no way for a customer to differ from the one hosted beside it.
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'organization', version: '1' })
export class AdministrationController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Get('tenant-settings')
  @ApiOperation({ summary: "This tenant's own defaults, or none if it has never configured any" })
  @ApiOkResponse({
    description:
      'The settings, or null. Null rather than the deployment defaults, so a tenant that has ' +
      'never been configured is distinguishable from one configured identically by hand.',
  })
  public async settings(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.tenant-settings',
      } satisfies ReadTenantSettings),
    );
  }

  @Put('tenant-settings')
  @ApiOperation({
    summary: 'Configure this tenant',
    description:
      'Submitted whole rather than field by field: these are what a settings screen submits ' +
      'together, and a half-applied set is a tenant in a state nobody chose.',
  })
  @ApiOkResponse({ description: 'The settings.' })
  public async configure(@Body() body: ConfigureTenantSettingsBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.configure-tenant-settings',
        language: body.language,
        calendar: body.calendar,
        timeZone: body.timeZone,
        numerals: body.numerals,
        invitationValidityDays: body.invitationValidityDays,
        defaultPortals: body.defaultPortals,
        ...(body.expectedVersion === undefined ? {} : { expectedVersion: body.expectedVersion }),
      } satisfies ConfigureTenantSettingsCommand),
    );
  }

  @Get('standard-unit-types')
  @ApiOperation({
    summary: 'The levels the specification names, offered as a starting set',
    description:
      'Nothing installs these. A tenant adopts the ones it has, edits them, or defines its own ' +
      '— which is what makes unlimited depth true rather than claimed (ADR-0034).',
  })
  @ApiOkResponse({ description: 'The suggested unit types, named in both languages.' })
  public standardUnitTypes(): unknown {
    return STANDARD_UNIT_TYPES;
  }

  @Get('export')
  @ApiOperation({
    summary: 'The whole organization as one document',
    description:
      "Every placement period, not just the ones in force: an export carrying only today's " +
      'structure would be a backup that discarded the history this module exists to keep.',
  })
  @ApiOkResponse({ description: 'The snapshot.' })
  public async exportStructure(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.export-structure',
      } satisfies ExportStructure),
    );
  }

  @Post('import')
  @ApiOperation({
    summary: 'Load a structure in bulk',
    description:
      'Dispatches the same commands an administrator would issue one at a time, so every ' +
      'invariant applies. Not atomic and deliberately resumable: an existing code is reused, ' +
      'so a corrected file can simply be run again.',
  })
  @ApiOkResponse({ description: 'What was created, reused and placed.' })
  public async importStructure(@Body() body: ImportStructureBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.import-structure',
        unitTypes: body.unitTypes,
        units: body.units.map((unit) => ({
          code: unit.code,
          unitTypeCode: unit.unitTypeCode,
          name: unit.name,
          ...(unit.description === undefined ? {} : { description: unit.description }),
          ...(unit.metadata === undefined ? {} : { metadata: unit.metadata }),
          ...(unit.parentCode === undefined ? {} : { parentCode: unit.parentCode }),
          effectiveFrom: new Date(unit.effectiveFrom),
        })),
      } satisfies ImportStructure),
    );
  }
}
