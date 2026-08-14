import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { MoveDevelopmentItemCommand } from '../application/development.use-case.js';
import type { DevelopmentItemStatus } from '../domain/career-vocabulary.js';

import { CareerDispatcher } from './career-dispatcher.js';
import { MoveDevelopmentItemBody } from './career-people.dto.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * An item's own lifecycle, addressed by the item's own identifier.
 *
 * Its own prefix rather than nested under the plan because **the command does not take a plan
 * identifier**. Routing it as `development-plans/:planId/items/:itemId/status` would put a segment
 * in the URL that nothing reads — a client could pass any plan it liked and the write would land on
 * the item regardless. A path segment the server ignores is a claim the API does not check, and this
 * one would read as an authorization scope.
 */
@ApiTags('career')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'career/development-items', version: '1' })
export class CareerDevelopmentItemController {
  public constructor(private readonly dispatcher: CareerDispatcher) {}

  @Post(':developmentItemId/status')
  @ApiOperation({ summary: 'Move an item. A completed item does not go back to planned' })
  public async move(
    @Param('developmentItemId', ParseUUIDPipe) developmentItemId: string,
    @Body() body: MoveDevelopmentItemBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, MoveDevelopmentItemCommand>({
        commandName: 'career.move-development-item',
        developmentItemId,
        to: body.to as DevelopmentItemStatus,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
