import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { RecordViolationCommand } from '../application/violation.use-case.js';
import type {
  ListViolationsForEmployment,
  ReadViolation,
} from '../application/relations-queries.js';

import { RecordViolationBody } from './relations.dto.js';
import { RelationsDispatcher } from './relations-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Recorded violations.
 *
 * **Every route here that returns a violation writes an access event** (AD-007). That is not a
 * side-effect the controller arranges — it happens inside the read's own transaction, so a read
 * whose trail could not be written does not return a record either.
 *
 * **There is no route that lists a tenant's violations.** The only collection read takes an
 * employment, because a query returning every disciplinary matter in an organisation is a watchlist
 * rather than a case file, and nobody approved one.
 *
 * **There is no update route and no delete route.** A recorded violation is immutable — the database
 * refuses both from any path, and there is no application method that could try.
 */
@ApiTags('relations')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'relations/violations', version: '1' })
export class ViolationController {
  public constructor(private readonly dispatcher: RelationsDispatcher) {}

  @Get()
  @ApiOperation({ summary: "One employment's recorded violations, newest conduct first" })
  @ApiOkResponse({ description: 'Each violation disclosed is recorded in the access trail.' })
  public async violations(
    @Query('employmentId') employmentId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ListViolationsForEmployment>({
        queryName: 'relations.violations',
        employmentId,
        ...(page === undefined ? {} : { page: Number(page) }),
        ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Record that a violation occurred, against an employment' })
  public async record(@Body() body: RecordViolationBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordViolationCommand>({
        commandName: 'relations.record-violation',
        ...body,
      }),
    );
  }

  @Get(':violationId')
  @ApiOperation({ summary: 'One recorded violation. Reading it is recorded against your name' })
  public async violation(@Param('violationId') violationId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadViolation>({
        queryName: 'relations.read-violation',
        violationId,
      }),
    );
  }
}
