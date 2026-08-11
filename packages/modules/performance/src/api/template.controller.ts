import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  DefineTemplateCommand,
  RetireTemplateCommand,
} from '../application/template.use-case.js';
import type { ListTemplates } from '../application/performance-queries.js';

import { VersionedBody } from './performance.dto.js';
import { DefineTemplateBody } from './template.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Review templates: which components a review has, and what each is worth.
 *
 * **A new version of a template is a new template**, defined with its own code and its own row.
 * There is no edit route and no `PUT`: a cycle names the template it runs on, and a template that
 * could be edited under a running cycle would change what a review in progress was being measured
 * against. Retirement takes one out of use for future cycles and touches nothing already rated.
 *
 * The component weights a template carries are **basis points that must total 10,000**, refused by
 * the domain rather than normalized. A template whose weights were silently rescaled would produce
 * scores nobody could reconcile against the configuration screen.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/templates', version: '1' })
export class PerformanceTemplateController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The review templates, with their components and weights' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListTemplates>({
        queryName: 'performance.templates',
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Define a template. Components are weighted in basis points' })
  @ApiOkResponse({
    description:
      'requiresSelfAssessment and requiresPeerAssessment say whether one is expected. Neither ' +
      'contributes to the score, and there is no weight for either.',
  })
  public async define(@Body() body: DefineTemplateBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineTemplateCommand>({
        commandName: 'performance.define-template',
        ...body,
      }),
    );
  }

  @Post(':templateId/retirement')
  @ApiOperation({ summary: 'Retire a template. Cycles already running are unaffected' })
  public async retire(
    @Param('templateId') templateId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RetireTemplateCommand>({
        commandName: 'performance.retire-template',
        templateId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
