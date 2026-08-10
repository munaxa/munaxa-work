import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  DefineComponentCommand,
  PublishComponentCommand,
} from '../application/component.use-case.js';
import type { ListComponents } from '../application/definition-queries.js';

import { DefineComponentBody, VersionedBody } from './compensation.dto.js';
import { CompensationDispatcher } from './compensation-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Compensation components: the configurable definition of a thing an employment can be entitled to.
 *
 * **Nothing is seeded.** No basic salary, no housing allowance, no transport allowance. Every one
 * of those is a component a tenant or a country pack defines, and a product that shipped them would
 * be asserting that every customer in every market wants the same set.
 *
 * **`deduction` is not a kind.** Deductions are out of scope for this phase; a caller asking for
 * one is refused by the domain, by the check constraint, and by the absence of any code that would
 * know what to do with it.
 */
@ApiTags('compensation')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'compensation/components', version: '1' })
export class CompensationComponentController {
  public constructor(private readonly dispatcher: CompensationDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'The component catalogue. Empty until a tenant configures one' })
  @ApiOkResponse({ description: 'Every component this tenant has defined.' })
  public async list(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListComponents>({ queryName: 'compensation.components' }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Draft a compensation component' })
  public async define(@Body() body: DefineComponentBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DefineComponentCommand>({
        commandName: 'compensation.define-component',
        ...body,
      }),
    );
  }

  @Post(':componentId/publication')
  @ApiOperation({ summary: 'Freeze a component, so plans and assignments may reference it' })
  public async publish(
    @Param('componentId') componentId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishComponentCommand>({
        commandName: 'compensation.publish-component',
        componentId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
