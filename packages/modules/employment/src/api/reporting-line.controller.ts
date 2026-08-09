import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ChangeManagerCommand } from '../application/reporting-line.use-case.js';
import type { ReadEmploymentHistory } from '../application/employment-queries.js';

import { ChangeManagerBody } from './employment.dto.js';
import { EmploymentDispatcher } from './employment-dispatcher.js';
import { asOfFrom } from './as-of.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The managerial relationship.
 *
 * A manager is named by **employment**, never by person. That is what keeps "who was this person's
 * manager in March" answerable after both of them have changed jobs — and it is why the request
 * body asks for a `managerEmploymentId` rather than a person.
 *
 * Manager Self-Service (Phase 19) is what eventually consumes this. Nothing here implements it, and
 * nothing here decides what a manager may *do*: that is authorization, and authorization is
 * Platform's.
 */
@ApiTags('employment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such employment in this tenant.' })
@Controller({ path: 'employments', version: '1' })
export class ReportingLineController {
  public constructor(private readonly dispatcher: EmploymentDispatcher) {}

  @Get(':employmentId/reporting-lines')
  @ApiOperation({ summary: "An employment's reporting history, oldest first" })
  @ApiOkResponse({ description: 'Every period, including the closed ones.' })
  public async list(@Param('employmentId') employmentId: string): Promise<unknown> {
    const history = await this.dispatcher.ask<
      { readonly reportingLines: unknown },
      ReadEmploymentHistory
    >({ queryName: 'employment.read-history', employmentId });

    return unwrapOrThrow(history).reportingLines;
  }

  @Post(':employmentId/manager')
  @ApiOperation({
    summary: 'Change who an employment reports to. Closes one period, opens another',
  })
  @ApiOkResponse({ description: 'The new reporting period.' })
  @ApiConflictResponse({
    description:
      'The manager’s employment has ended, or the change would close a loop in the hierarchy.',
  })
  public async changeManager(
    @Param('employmentId') employmentId: string,
    @Body() body: ChangeManagerBody,
  ): Promise<unknown> {
    const parsed = asOfFrom(body.effectiveFrom);

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ChangeManagerCommand>({
        commandName: 'employment.change-manager',
        employmentId,
        managerEmploymentId: body.managerEmploymentId,
        ...(parsed.asOf === undefined ? {} : { effectiveFrom: parsed.asOf }),
      }),
    );
  }
}
