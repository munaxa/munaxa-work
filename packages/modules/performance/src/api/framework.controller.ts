import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  DefineCompetencyCommand,
  DefineFrameworkCommand,
  RetireFrameworkCommand,
} from '../application/competency.use-case.js';
import type { ListFrameworks } from '../application/performance-queries.js';

import { DefineCompetencyBody, DefineFrameworkBody, VersionedBody } from './performance.dto.js';
import { PerformanceDispatcher } from './performance-dispatcher.js';
import { civil, civilIf, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Competency frameworks and the competencies inside them.
 *
 * A framework carries an explicit `frameworkVersion` rather than being versioned implicitly by
 * date. Two frameworks may be effective at once — a customer running last year's for a cycle already
 * open and this year's for the next — and a review names the one it was rated against, so a later
 * edition changes nothing about a rating already given.
 *
 * `POST /performance/frameworks/:frameworkId/competencies` is nested rather than flat because a
 * competency has no meaning outside its framework: the authorization that matters is over the
 * framework, and a flat route would invite a client to think otherwise.
 */
@ApiTags('performance')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'performance/frameworks', version: '1' })
export class PerformanceFrameworkController {
  public constructor(private readonly dispatcher: PerformanceDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The competency frameworks, with their competencies and levels' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListFrameworks>({
        queryName: 'performance.frameworks',
        ...paged(query),
      }),
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Define a framework. A weighted one requires weights on its competencies',
  })
  public async define(@Body() body: DefineFrameworkBody): Promise<unknown> {
    const { effectiveFrom, effectiveTo, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineFrameworkCommand>({
        commandName: 'performance.define-framework',
        ...rest,
        effectiveFrom: civil(effectiveFrom),
        ...present({ effectiveTo: civilIf(effectiveTo) }),
      }),
    );
  }

  @Post(':frameworkId/competencies')
  @ApiOperation({ summary: 'Add a competency and its behavioural levels' })
  @ApiOkResponse({
    description:
      'A weight is refused unless the framework is weighted, and an absent weight is absent ' +
      'rather than zero — the difference decides whether the competency leaves the denominator.',
  })
  public async defineCompetency(
    @Param('frameworkId') frameworkId: string,
    @Body() body: DefineCompetencyBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineCompetencyCommand>({
        commandName: 'performance.define-competency',
        ...body,
        frameworkId,
      }),
    );
  }

  @Post(':frameworkId/retirement')
  @ApiOperation({ summary: 'Retire a framework. Reviews rated against it keep their frozen copy' })
  public async retire(
    @Param('frameworkId') frameworkId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RetireFrameworkCommand>({
        commandName: 'performance.retire-framework',
        frameworkId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
