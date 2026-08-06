import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type {
  RescanPersonCommand,
  ReviewDuplicateCommand,
} from '../application/duplicate.use-case.js';
import type { ListDuplicates } from '../application/people-queries.js';
import type { MergePeopleCommand } from '../application/person-record.use-case.js';

import { MergePeopleBody } from './people.dto.js';
import { ReviewDuplicateBody } from './profile.dto.js';
import { PeopleDispatcher } from './people-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The review queue, and the merge it can lead to.
 *
 * The merge lives here rather than with the person's other lifecycle operations, because it is the
 * *outcome* of a review and holds its own permission: a reviewer clearing a queue must not be able
 * to trigger one by accident.
 *
 * `POST /people/duplicates/rescan/{personId}` is the "background validation" the specification
 * asks for, exposed as a command rather than a schedule. This product has no scheduler until
 * Phase 24, and a sweep that pretended to run on a timer would be a claim nothing keeps. The
 * operation is idempotent and safe to run repeatedly, which is what a job will call when there is
 * one.
 */
@ApiTags('people')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'people', version: '1' })
export class DuplicatesController {
  public constructor(private readonly dispatcher: PeopleDispatcher) {}

  @Get('duplicates')
  @ApiOperation({ summary: 'The review queue: pairs the system suspects are one human being' })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ description: 'A page of candidates, strongest evidence first.' })
  public async list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'people.list-duplicates',
        ...(status === undefined ? {} : { status }),
        ...(page === undefined ? {} : { page: Number(page) }),
        ...(size === undefined ? {} : { size: Number(size) }),
      } satisfies ListDuplicates),
    );
  }

  @Patch('duplicates/:candidateId')
  @ApiOperation({
    summary: 'Decide. Confirming does not merge — a merge is a separate, separately held command',
  })
  @ApiOkResponse({ description: 'The candidate.' })
  public async review(
    @Param('candidateId') candidateId: string,
    @Body() body: ReviewDuplicateBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.review-duplicate',
        candidateId,
        decision: body.decision,
        ...(body.note === undefined ? {} : { note: body.note }),
        expectedVersion: body.expectedVersion,
      } satisfies ReviewDuplicateCommand),
    );
  }

  @Post('duplicates/rescan/:personId')
  @ApiOperation({ summary: 'Re-run detection for one person. Idempotent, and safe to repeat' })
  @ApiOkResponse({ description: 'How many new candidates were queued.' })
  public async rescan(@Param('personId') personId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.rescan-person',
        personId,
      } satisfies RescanPersonCommand),
    );
  }

  @Post(':personId/merge')
  @ApiOperation({
    summary: 'Record that this record and another are one human being. A redirect, not a deletion',
  })
  @ApiOkResponse({ description: 'The merged person.' })
  public async merge(
    @Param('personId') personId: string,
    @Body() body: MergePeopleBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.merge-people',
        personId,
        survivorPersonId: body.survivorPersonId,
        expectedVersion: body.expectedVersion,
      } satisfies MergePeopleCommand),
    );
  }
}
