import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type { ListPositions } from '../application/organization-queries.js';
import type {
  DefinePositionCommand,
  RetirePositionCommand,
  RevisePositionCommand,
} from '../application/position.use-case.js';

import { CloseEffectiveBody } from './organization.dto.js';
import { DefinePositionBody, RevisePositionBody } from './planning.dto.js';
import { OrganizationDispatcher } from './organization-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The position catalogue: reusable role definitions the whole organization draws on.
 *
 * No endpoint here takes a person, and none ever will. People occupy positions through
 * Employment assignments (AD-006); this module defines what a position *is*.
 */
@ApiTags('organization')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'organization', version: '1' })
export class PositionsController {
  public constructor(private readonly dispatcher: OrganizationDispatcher) {}

  @Get('positions')
  @ApiOperation({ summary: 'Search the catalogue by code or title, in either language' })
  @ApiQuery({ name: 'term', required: false })
  @ApiQuery({ name: 'family', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ description: 'A page of positions.' })
  public async list(
    @Query('term') term?: string,
    @Query('family') family?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'organization.list-positions',
        ...(term === undefined ? {} : { term }),
        ...(family === undefined ? {} : { family }),
        ...(status === undefined ? {} : { status }),
        ...(page === undefined ? {} : { page: Number(page) }),
        ...(size === undefined ? {} : { size: Number(size) }),
      } satisfies ListPositions),
    );
  }

  @Post('positions')
  @ApiOperation({ summary: 'Define a reusable role. A position is not an employee' })
  @ApiOkResponse({ description: 'The position.' })
  public async define(@Body() body: DefinePositionBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.define-position',
        code: body.code,
        title: body.title,
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.family === undefined ? {} : { family: body.family }),
        ...(body.grade === undefined ? {} : { grade: body.grade }),
        ...(body.criticality === undefined ? {} : { criticality: body.criticality }),
        ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
        effectiveFrom: new Date(body.effectiveFrom),
      } satisfies DefinePositionCommand),
    );
  }

  @Patch('positions/:positionId')
  @ApiOperation({ summary: 'Revise a definition' })
  @ApiOkResponse({ description: 'The position.' })
  public async revise(
    @Param('positionId') positionId: string,
    @Body() body: RevisePositionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.revise-position',
        positionId,
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.family === undefined ? {} : { family: body.family }),
        ...(body.grade === undefined ? {} : { grade: body.grade }),
        ...(body.criticality === undefined ? {} : { criticality: body.criticality }),
        expectedVersion: body.expectedVersion,
      } satisfies RevisePositionCommand),
    );
  }

  @Patch('positions/:positionId/retire')
  @ApiOperation({ summary: 'Retire a definition. Contracts naming it still resolve' })
  @ApiOkResponse({ description: 'The retired position.' })
  public async retire(
    @Param('positionId') positionId: string,
    @Body() body: CloseEffectiveBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'organization.retire-position',
        positionId,
        effectiveTo: new Date(body.effectiveTo),
        expectedVersion: body.expectedVersion,
      } satisfies RetirePositionCommand),
    );
  }
}
