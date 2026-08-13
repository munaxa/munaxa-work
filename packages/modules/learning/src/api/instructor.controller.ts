import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  DeactivateInstructorCommand,
  RegisterInstructorCommand,
} from '../application/instructor.use-case.js';
import type { ListInstructors } from '../application/learning-queries.js';

import { VersionedBody } from './learning.dto.js';
import { RegisterInstructorBody } from './learner.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { flag, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Who delivers training: a colleague, or somebody from outside.
 *
 * An internal instructor is named by their employment, which is confirmed through Employment's
 * published query — copying their name here would create a second copy to go stale the day they
 * change it. An external one is not in Employment at all, so their name lives here.
 *
 * **Deactivation is a `POST` to a sub-resource and it is not deletion.** A course delivered in 2023
 * by somebody who has since left is still explainable, and a deleted instructor would make a
 * completion record point at nothing.
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/instructors', version: '1' })
export class LearningInstructorController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'List instructors. Bounded' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async list(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListInstructors>({
        queryName: 'learning.list-instructors',
        ...paged(query),
        ...flag(query, 'activeOnly'),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Register an instructor: an employment, or an external name' })
  public async register(@Body() body: RegisterInstructorBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RegisterInstructorCommand>({
        commandName: 'learning.register-instructor',
        ...present({
          employmentId: body.employmentId,
          externalName: body.externalName,
          externalOrganization: body.externalOrganization,
          externalContact: body.externalContact,
        }),
      }),
    );
  }

  @Post(':instructorId/deactivation')
  @ApiOperation({ summary: 'Stop offering an instructor. Not deletion' })
  public async deactivate(
    @Param('instructorId') instructorId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DeactivateInstructorCommand>({
        commandName: 'learning.deactivate-instructor',
        instructorId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
