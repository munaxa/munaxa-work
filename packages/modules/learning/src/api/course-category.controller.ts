import { Body, Controller, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { CreateCategoryCommand } from '../application/catalogue.use-case.js';

import { CreateCategoryBody } from './learning.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The tenant's own filing of its catalogue.
 *
 * **No rule in this product reads a category** (AD-003). It exists so an administrator can find a
 * course, and nothing branches on it — which is why there is no route to make one mandatory, to
 * assign one, or to report compliance by one.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/course-categories', version: '1' })
export class LearningCourseCategoryController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Post()
  @ApiOperation({ summary: 'File a new course category' })
  @ApiConflictResponse({ description: 'The code is already used in this tenant.' })
  public async create(@Body() body: CreateCategoryBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateCategoryCommand>({
        commandName: 'learning.create-course-category',
        code: body.code,
        name: body.name,
      }),
    );
  }
}
