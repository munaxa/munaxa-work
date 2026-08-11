import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  ChangeEmploymentStatusCommand,
  EndEmploymentCommand,
} from '../application/lifecycle.use-case.js';

import { ChangeStatusBody, EndEmploymentBody } from './employment.dto.js';
import { EmploymentDispatcher } from './employment-dispatcher.js';
import { asOfFrom } from './as-of.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The lifecycle.
 *
 * **Ending has its own endpoint and its own permission.** Every other transition is reversible; this
 * one is terminal, it is what final settlement and end-of-service calculations read, and a
 * returning employee is a new employment rather than a reopened one. Folding it into the generic
 * status endpoint would mean anybody who can stand somebody down can also dismiss them.
 *
 * Both are `POST` sub-resources rather than a `PATCH` of a status field, because a transition is an
 * event with a reason and an effective date — not the assignment of a value.
 */
@ApiTags('employment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such employment in this tenant.' })
@ApiConflictResponse({ description: 'The employment changed since the caller read it.' })
@ApiUnprocessableEntityResponse({ description: 'The transition is not permitted from this state.' })
@Controller({ path: 'employments', version: '1' })
export class EmploymentLifecycleController {
  public constructor(private readonly dispatcher: EmploymentDispatcher) {}

  @Post(':employmentId/status')
  @ApiOperation({ summary: 'Submit, activate, suspend or reinstate an employment' })
  @ApiOkResponse({
    description: 'The employment, moved. The transition is recorded in its history.',
  })
  public async changeStatus(
    @Param('employmentId') employmentId: string,
    @Body() body: ChangeStatusBody,
  ): Promise<unknown> {
    const { effectiveFrom, ...rest } = body;

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ChangeEmploymentStatusCommand>({
        commandName: 'employment.change-status',
        employmentId,
        ...rest,
        ...effectiveFromOf(effectiveFrom),
      }),
    );
  }

  @Post(':employmentId/end')
  @ApiOperation({
    summary: 'End an employment. Terminal, dated and explained — and a separate permission',
  })
  @ApiOkResponse({ description: 'The employment, ended. Payroll reads this for final settlement.' })
  public async end(
    @Param('employmentId') employmentId: string,
    @Body() body: EndEmploymentBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, EndEmploymentCommand>({
        commandName: 'employment.end-employment',
        employmentId,
        ...body,
      }),
    );
  }
}

/** A civil date on the wire becomes the instant the timeline is dated on. */
const effectiveFromOf = (value: string | undefined): { readonly effectiveFrom?: Date } => {
  const parsed = asOfFrom(value);

  return parsed.asOf === undefined ? {} : { effectiveFrom: parsed.asOf };
};
