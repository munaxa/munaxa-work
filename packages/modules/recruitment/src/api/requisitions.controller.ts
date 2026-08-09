import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { CreateRequisitionCommand } from '../application/requisition.use-case.js';
import type { ReadRequisition, SearchRequisitions } from '../application/recruitment-queries.js';

import { CreateRequisitionBody } from './requisition.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { paging, requisitionFilters } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Raising and reading requisitions: the authority to hire.
 *
 * The decisions taken on one live on their own controller, because approving is a different
 * permission from managing — a requisition commits headcount spending, and the person who drafts the
 * request is not automatically the person who may commit the budget.
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such requisition in this tenant.' })
@Controller({ path: 'recruitment/requisitions', version: '1' })
export class RequisitionsController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search requisitions' })
  @ApiOkResponse({ description: 'A page of requisitions.' })
  public async search(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchRequisitions>({
        queryName: 'recruitment.search-requisitions',
        ...requisitionFilters(query),
        ...paging(query),
      }),
    );
  }

  @Get(':requisitionId')
  @ApiOperation({ summary: 'One requisition, its decisions and its vacancies' })
  @ApiOkResponse({ description: 'Including every decision, so an audit can follow the authority.' })
  public async read(@Param('requisitionId') requisitionId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadRequisition>({
        queryName: 'recruitment.read-requisition',
        requisitionId,
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Raise a requisition. The number is generated' })
  @ApiCreatedResponse({ description: 'The requisition identifier and its generated number.' })
  public async create(@Body() body: CreateRequisitionBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateRequisitionCommand>({
        commandName: 'recruitment.create-requisition',
        ...body,
      }),
    );
  }
}
