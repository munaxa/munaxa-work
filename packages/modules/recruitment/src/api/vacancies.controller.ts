import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  CloseVacancyCommand,
  OpenVacancyCommand,
  PublishVacancyCommand,
} from '../application/vacancy.use-case.js';
import type { SearchVacancies } from '../application/recruitment-queries.js';
import type { ReadPipeline } from '../application/pipeline-queries.js';

import { CloseVacancyBody, OpenVacancyBody, PublishVacancyBody } from './requisition.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { paging, vacancyFilters } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Vacancies: the openings that accept applications.
 *
 * **Publishing is its own permission**, because publication is the moment a posting becomes
 * externally visible and in several of this product's markets a published advertisement carries
 * obligations a draft does not. Both opening and publishing refuse without an approved requisition.
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such vacancy or requisition in this tenant.' })
@Controller({ path: 'recruitment/vacancies', version: '1' })
export class VacanciesController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search vacancies' })
  @ApiOkResponse({ description: 'A page of vacancies.' })
  public async search(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchVacancies>({
        queryName: 'recruitment.search-vacancies',
        ...vacancyFilters(query),
        ...paging(query),
      }),
    );
  }

  @Get(':vacancyId/pipeline')
  @ApiOperation({ summary: 'The pipeline board: counts per status' })
  @ApiOkResponse({ description: 'Counted in the database rather than by loading applications.' })
  public async pipeline(@Param('vacancyId') vacancyId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadPipeline>({
        queryName: 'recruitment.read-pipeline',
        vacancyId,
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Open a vacancy against an approved requisition' })
  @ApiCreatedResponse({ description: 'The vacancy identifier.' })
  @ApiUnprocessableEntityResponse({
    description: 'The requisition is not approved. Recruiting without one is hiring nobody agreed.',
  })
  public async open(@Body() body: OpenVacancyBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, OpenVacancyCommand>({
        commandName: 'recruitment.open-vacancy',
        ...body,
      }),
    );
  }

  @Post(':vacancyId/publication')
  @ApiOperation({ summary: 'Publish. Requires recruitment.vacancy.publish' })
  public async publish(
    @Param('vacancyId') vacancyId: string,
    @Body() body: PublishVacancyBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishVacancyCommand>({
        commandName: 'recruitment.publish-vacancy',
        vacancyId,
        ...body,
      }),
    );
  }

  @Post(':vacancyId/closure')
  @ApiOperation({ summary: 'Close a vacancy' })
  public async close(
    @Param('vacancyId') vacancyId: string,
    @Body() body: CloseVacancyBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CloseVacancyCommand>({
        commandName: 'recruitment.close-vacancy',
        vacancyId,
        ...body,
      }),
    );
  }
}
