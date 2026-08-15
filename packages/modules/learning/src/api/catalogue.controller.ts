import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  ArchiveCourseCommand,
  CreateCourseCommand,
  PublishCourseVersionCommand,
  UpdateCourseCommand,
} from '../application/catalogue.use-case.js';
import type { ReadCourse, SearchCourses } from '../application/learning-queries.js';
import type { CourseDelivery } from '../domain/learning-vocabulary.js';

import {
  CreateCourseBody,
  PublishCourseVersionBody,
  UpdateCourseBody,
  VersionedBody,
} from './learning.dto.js';
import { LearningDispatcher } from './learning-dispatcher.js';
import { optional, paged, present } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Courses, and the versions that say what one currently teaches.
 *
 * **A course's lifecycle is never a `PATCH`.** `PATCH` amends the descriptive fields a course
 * carries — its name, its description, its filing. Publishing a version and archiving a course are
 * `POST`s to their own sub-resources, because each is an act with its own rules, its own permission
 * check and its own refusal, and a status field a client could set to `archived` would let a typo
 * retire a mandatory safety course.
 *
 * **A version number is never on the wire.** It is derived from what is already published: two
 * administrators supplying "4" would race for one unique index and the loser would get an error
 * nobody could act on. The *course's* `expectedVersion` settles that race instead, and the loser is
 * told the course moved and reads it again — a 409, never a 500.
 *
 * **What a course teaches is versioned and unreachable from `PATCH`.** A completion in 2023
 * describes the version somebody actually sat, and editing that content in place would rewrite the
 * meaning of a certificate already in somebody's file (AD-004).
 */
@ApiTags('learning')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'learning/courses', version: '1' })
export class LearningCourseController {
  public constructor(private readonly dispatcher: LearningDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search the catalogue. Bounded; there is no unbounded course read' })
  @ApiOkResponse({ description: 'A page beyond the last is an empty page, not a refusal.' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchCourses>({
        queryName: 'learning.search-courses',
        ...paged(query),
        ...optional(query, ['status', 'delivery', 'categoryId']),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Add a course. It starts in draft and teaches nothing until published' })
  @ApiConflictResponse({ description: 'The code is already used in this tenant.' })
  public async create(@Body() body: CreateCourseBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateCourseCommand>({
        commandName: 'learning.create-course',
        code: body.code,
        name: body.name,
        delivery: body.delivery as CourseDelivery,
        ...present({ description: body.description, categoryId: body.categoryId }),
      }),
    );
  }

  @Get(':courseId')
  @ApiOperation({ summary: 'One course with every version it has had, and their assessments' })
  public async read(@Param('courseId') courseId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCourse>({
        queryName: 'learning.read-course',
        courseId,
      }),
    );
  }

  @Patch(':courseId')
  @ApiOperation({ summary: 'Amend a course’s description. Never its code, delivery or lifecycle' })
  public async update(
    @Param('courseId') courseId: string,
    @Body() body: UpdateCourseBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, UpdateCourseCommand>({
        commandName: 'learning.update-course',
        courseId,
        expectedVersion: body.expectedVersion,
        ...present({
          name: body.name,
          description: body.description,
          categoryId: body.categoryId,
        }),
      }),
    );
  }

  @Post(':courseId/versions')
  @ApiOperation({ summary: 'Publish the next version. Its number is derived, never supplied' })
  public async publishVersion(
    @Param('courseId') courseId: string,
    @Body() body: PublishCourseVersionBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, PublishCourseVersionCommand>({
        commandName: 'learning.publish-course-version',
        courseId,
        expectedVersion: body.expectedVersion,
        title: body.title,
        requiresAssessment: body.requiresAssessment,
        ...present({
          objectives: body.objectives,
          contentReference: body.contentReference,
          durationMinutes: body.durationMinutes,
          certificationValidMonths: body.certificationValidMonths,
        }),
      }),
    );
  }

  @Post(':courseId/archive')
  @ApiOperation({ summary: 'Archive a course. Terminal, and not deletion' })
  public async archive(
    @Param('courseId') courseId: string,
    @Body() body: VersionedBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ArchiveCourseCommand>({
        commandName: 'learning.archive-course',
        courseId,
        expectedVersion: body.expectedVersion,
      }),
    );
  }
}
