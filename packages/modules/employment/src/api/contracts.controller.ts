import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type {
  ConcludeProbationCommand,
  RecordContractCommand,
} from '../application/contract.use-case.js';
import type { ReadEmploymentHistory } from '../application/employment-queries.js';

import { ConcludeProbationBody, RecordContractBody } from './contract.dto.js';
import { EmploymentDispatcher } from './employment-dispatcher.js';
import { asOfFrom } from './as-of.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Contracts and probation.
 *
 * A renewal is a **new contract period** rather than an edit, so "which terms applied on the date
 * that decision was taken" stays answerable after the terms change.
 *
 * The document is a **reference**. Employment stores no bytes and builds no document management
 * (§24) — that is the future Documents domain's, and this is the seam it will be reached through.
 */
@ApiTags('employment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such employment or contract in this tenant.' })
@Controller({ path: 'employments', version: '1' })
export class ContractsController {
  public constructor(private readonly dispatcher: EmploymentDispatcher) {}

  @Get(':employmentId/contracts')
  @ApiOperation({ summary: "An employment's contract history, oldest first" })
  @ApiOkResponse({ description: 'Every period, including the superseded ones.' })
  public async list(@Param('employmentId') employmentId: string): Promise<unknown> {
    const history = await this.dispatcher.ask<
      { readonly contracts: unknown },
      ReadEmploymentHistory
    >({ queryName: 'employment.read-history', employmentId });

    return unwrapOrThrow(history).contracts;
  }

  @Post(':employmentId/contracts')
  @ApiOperation({ summary: 'Record a contract. A renewal is a new period, never an edit' })
  @ApiCreatedResponse({ description: 'The contract period.' })
  public async record(
    @Param('employmentId') employmentId: string,
    @Body() body: RecordContractBody,
  ): Promise<unknown> {
    const { effectiveFrom, ...rest } = body;
    const parsed = asOfFrom(effectiveFrom);

    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RecordContractCommand>({
        commandName: 'employment.record-contract',
        employmentId,
        ...rest,
        ...(parsed.asOf === undefined ? {} : { effectiveFrom: parsed.asOf }),
      }),
    );
  }

  @Post(':employmentId/contracts/:contractId/probation')
  @ApiOperation({ summary: 'Record how a probation concluded: passed or waived' })
  @ApiUnprocessableEntityResponse({
    description:
      'There is no probation on this contract, or it has already concluded. A probation somebody did not pass ends the employment instead.',
  })
  public async concludeProbation(
    @Param('employmentId') employmentId: string,
    @Param('contractId') contractId: string,
    @Body() body: ConcludeProbationBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ConcludeProbationCommand>({
        commandName: 'employment.conclude-probation',
        employmentId,
        contractId,
        ...body,
      }),
    );
  }
}
