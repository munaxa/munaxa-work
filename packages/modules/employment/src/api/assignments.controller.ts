import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type {
  ChangeAssignmentCommand,
  CreateAssignmentCommand,
} from '../application/assignment.use-case.js';
import type { ReadEmploymentHistory } from '../application/employment-queries.js';

import { AssignmentBody } from './employment.dto.js';
import { EmploymentDispatcher } from './employment-dispatcher.js';
import { asOfFrom } from './as-of.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Organizational placement.
 *
 * `POST .../assignments/change` is what §38 calls changing position, changing location and changing
 * cost centre. They are one operation here because they are one event in the business — somebody's
 * placement changed on a date — and four endpoints writing four rows for one move would produce a
 * timeline nobody could read.
 *
 * A change **closes the period in force and opens a new one**. Nothing is edited, which is what
 * keeps "which department did this person belong to when that decision was taken" answerable.
 */
@ApiTags('employment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such employment or unit in this tenant.' })
@Controller({ path: 'employments', version: '1' })
export class AssignmentsController {
  public constructor(private readonly dispatcher: EmploymentDispatcher) {}

  @Get(':employmentId/assignments')
  @ApiOperation({ summary: "An employment's placement history, oldest first" })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiOkResponse({ description: 'Every period, including the closed ones.' })
  public async list(@Param('employmentId') employmentId: string): Promise<unknown> {
    const history = await this.dispatcher.ask<
      { readonly assignments: unknown },
      ReadEmploymentHistory
    >({ queryName: 'employment.read-history', employmentId });

    return unwrapOrThrow(history).assignments;
  }

  @Post(':employmentId/assignments')
  @ApiOperation({ summary: 'Place an employment in the organization' })
  @ApiCreatedResponse({ description: 'The assignment.' })
  @ApiConflictResponse({ description: 'A primary assignment is already in force on that date.' })
  public async create(
    @Param('employmentId') employmentId: string,
    @Body() body: AssignmentBody,
  ): Promise<unknown> {
    const { effectiveFrom, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateAssignmentCommand>({
        commandName: 'employment.create-assignment',
        employmentId,
        ...rest,
        ...effectiveFromOf(effectiveFrom),
      }),
    );
  }

  @Post(':employmentId/assignments/change')
  @ApiOperation({
    summary: 'Transfer: change unit, position or cost centre. Closes one period and opens another',
  })
  @ApiOkResponse({ description: 'The new assignment period.' })
  @ApiConflictResponse({ description: 'There is no primary assignment in force to change.' })
  public async change(
    @Param('employmentId') employmentId: string,
    @Body() body: AssignmentBody,
  ): Promise<unknown> {
    const { effectiveFrom, assignmentType: _ignored, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ChangeAssignmentCommand>({
        commandName: 'employment.change-assignment',
        employmentId,
        ...rest,
        ...effectiveFromOf(effectiveFrom),
      }),
    );
  }
}

const effectiveFromOf = (value: string | undefined): { readonly effectiveFrom?: Date } => {
  const parsed = asOfFrom(value);

  return parsed.asOf === undefined ? {} : { effectiveFrom: parsed.asOf };
};
