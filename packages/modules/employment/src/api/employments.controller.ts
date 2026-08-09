import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AmendEmploymentCommand,
  CreateEmploymentCommand,
  ReviseEmploymentMetadataCommand,
} from '../application/employment.use-case.js';
import type { ReadEmployment, SearchEmployments } from '../application/employment-queries.js';

import { AmendEmploymentBody, CreateEmploymentBody, ReviseMetadataBody } from './employment.dto.js';
import { EmploymentDispatcher } from './employment-dispatcher.js';
import { asOfFrom } from './as-of.js';
import { textFilters } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The workforce.
 *
 * Two things about this surface are the phase's claims made reachable.
 *
 * **`?asOf=` on every read.** An employment's department, position, cost centre and manager are all
 * facts about a date. Omitting it means today; supplying it renders the placement in force then.
 *
 * **A create carries no employment number.** It is generated, and the response returns it. A body
 * that could supply one would be a body that could reuse one (ADR-0039).
 */
@ApiTags('employment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'employments', version: '1' })
export class EmploymentsController {
  public constructor(private readonly dispatcher: EmploymentDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search the workforce by number, status, placement or manager' })
  @ApiQuery({ name: 'term', required: false, description: 'Employment number or external number.' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'personId', required: false })
  @ApiQuery({ name: 'employmentTypeCode', required: false })
  @ApiQuery({ name: 'unitId', required: false })
  @ApiQuery({ name: 'positionId', required: false })
  @ApiQuery({ name: 'costCenterId', required: false })
  @ApiQuery({ name: 'managerEmploymentId', required: false })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'size', required: false })
  @ApiOkResponse({ description: 'A page of employments, each resolved as at the requested date.' })
  public async search(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchEmployments>({
        queryName: 'employment.search',
        ...textFilters(query),
        ...asOfFrom(query['asOf']),
        ...(query['page'] === undefined ? {} : { page: Number(query['page']) }),
        ...(query['size'] === undefined ? {} : { size: Number(query['size']) }),
      }),
    );
  }

  @Get(':employmentId')
  @ApiOperation({ summary: 'One employment as it stood on a date' })
  @ApiQuery({ name: 'asOf', required: false })
  public async read(
    @Param('employmentId') employmentId: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadEmployment>({
        queryName: 'employment.read-employment',
        employmentId,
        ...asOfFrom(asOf),
      }),
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Create an employment. The employment number is generated and cannot be supplied',
  })
  @ApiCreatedResponse({ description: 'The employment, with the number allocated to it.' })
  @ApiConflictResponse({ description: 'This person already has an employment that has not ended.' })
  public async create(@Body() body: CreateEmploymentBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateEmploymentCommand>({
        commandName: 'employment.create-employment',
        ...body,
      }),
    );
  }

  @Patch(':employmentId')
  @ApiOperation({ summary: 'Amend how an employment is classified' })
  @ApiConflictResponse({ description: 'The employment changed since the caller read it.' })
  public async amend(
    @Param('employmentId') employmentId: string,
    @Body() body: AmendEmploymentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendEmploymentCommand>({
        commandName: 'employment.amend-employment',
        employmentId,
        ...body,
      }),
    );
  }

  @Patch(':employmentId/metadata')
  @ApiOperation({ summary: "Replace the tenant's own metadata on an employment" })
  public async reviseMetadata(
    @Param('employmentId') employmentId: string,
    @Body() body: ReviseMetadataBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ReviseEmploymentMetadataCommand>({
        commandName: 'employment.revise-metadata',
        employmentId,
        ...body,
      }),
    );
  }
}
