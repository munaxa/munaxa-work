import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AmendLegalEntityCommand,
  CloseLegalEntityCommand,
  RegisterLegalEntityCommand,
} from '../application/legal-entity.use-case.js';
import type { ListLegalEntities } from '../application/organization-queries.js';

import {
  AmendLegalEntityBody,
  CloseEffectiveBody,
  RegisterLegalEntityBody,
} from './organization.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The legally constituted entities the tenant operates through.
 *
 * The country lives here and nowhere else. Phase 11.1 resolves a country pack from a legal
 * entity, so a tenant with a Saudi company and a Jordanian one computes end of service under two
 * different laws in the same tenant — which a tenant-level country would make impossible without
 * a second tenant per country (00B).
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'organization', version: '1' })
export class LegalEntitiesController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Get('legal-entities')
  @ApiOperation({ summary: 'Every registration the tenant holds, and the country of each' })
  @ApiOkResponse({ description: 'The legal entities.' })
  public async list(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.list-legal-entities',
      } satisfies ListLegalEntities),
    );
  }

  @Post('units/:unitId/legal-entity')
  @ApiOperation({
    summary: 'Register a legal entity against a unit',
    description:
      'Permitted only where the unit type says it carries one — which is the tenant deciding ' +
      'whether it registers a single company or each branch separately, not this product.',
  })
  @ApiOkResponse({ description: 'The registration.' })
  public async register(
    @Param('unitId') unitId: string,
    @Body() body: RegisterLegalEntityBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.register-legal-entity',
        unitId,
        countryCode: body.countryCode,
        registeredName: body.registeredName,
        registrationNumber: body.registrationNumber,
        ...(body.taxIdentifier === undefined ? {} : { taxIdentifier: body.taxIdentifier }),
        currencyCode: body.currencyCode,
        ...(body.incorporatedOn === undefined
          ? {}
          : { incorporatedOn: new Date(body.incorporatedOn) }),
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies RegisterLegalEntityCommand),
    );
  }

  @Patch('legal-entities/:legalEntityId')
  @ApiOperation({
    summary: 'Amend a registration',
    description:
      'The country is not amendable. An entity that changed country is a different registration ' +
      'under a different law, and re-pointing this one would recompute every past statutory ' +
      'figure against rules that never applied to it.',
  })
  @ApiOkResponse({ description: 'The amended registration.' })
  public async amend(
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: AmendLegalEntityBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.amend-legal-entity',
        legalEntityId,
        ...(body.registeredName === undefined ? {} : { registeredName: body.registeredName }),
        ...(body.registrationNumber === undefined
          ? {}
          : { registrationNumber: body.registrationNumber }),
        ...(body.taxIdentifier === undefined ? {} : { taxIdentifier: body.taxIdentifier }),
        ...(body.currencyCode === undefined ? {} : { currencyCode: body.currencyCode }),
        expectedVersion: body.expectedVersion,
      } satisfies AmendLegalEntityCommand),
    );
  }

  @Patch('legal-entities/:legalEntityId/close')
  @ApiOperation({ summary: 'Close a registration from a date. Everything under it still resolves' })
  @ApiOkResponse({ description: 'The closed registration.' })
  public async close(
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: CloseEffectiveBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.close-legal-entity',
        legalEntityId,
        effectiveTo: new Date(body.effectiveTo),
        expectedVersion: body.expectedVersion,
      } satisfies CloseLegalEntityCommand),
    );
  }
}
