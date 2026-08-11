import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';

import type {
  ExportWorkforce,
  ImportEmploymentsCommand,
} from '../application/transfer.use-case.js';
import { IMPORT_LIMIT } from '../application/transfer.use-case.js';

import { ImportRowBody } from './contract.dto.js';
import { EmploymentDispatcher } from './employment-dispatcher.js';
import { asOfFrom } from './as-of.js';
import { unwrapOrThrow } from './handler-result.js';

class ImportEmploymentsRequest {
  @IsArray()
  @ArrayMaxSize(IMPORT_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => ImportRowBody)
  public readonly rows!: ImportRowBody[];
}

/**
 * Bringing a workforce in, and taking one out.
 *
 * **Import sends the same commands an administrator would.** Every invariant a create enforces
 * applies to a migration exactly as it applies to one hire, and a row for somebody already employed
 * is *skipped* rather than failed — which is what makes a re-run after a partial import safe.
 *
 * **Export is permissioned separately from reading**, and carries no person names. One response is
 * every employment and every placement in the tenant; joining names into it would put the whole
 * register's personal data into a file governed by this module's permission rather than People's.
 */
@ApiTags('employment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'employments', version: '1' })
export class TransferController {
  public constructor(private readonly dispatcher: EmploymentDispatcher) {}

  @Get('export')
  @ApiOperation({
    summary: 'Every employment and every timeline. Bounded, and separately permissioned',
  })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiOkResponse({
    description: 'The workforce. No person names — those are People’s to disclose.',
  })
  @ApiConflictResponse({ description: 'Too large for a synchronous export.' })
  public async export(@Query('asOf') asOf?: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ExportWorkforce>({
        queryName: 'employment.export-workforce',
        ...asOfFrom(asOf),
      }),
    );
  }

  @Post('import')
  @ApiOperation({ summary: 'Create employments in bulk. Resumable: an employed person is skipped' })
  @ApiOkResponse({ description: 'How many were created, skipped, and which rows failed.' })
  @ApiConflictResponse({ description: 'More rows than a synchronous import accepts.' })
  public async import(@Body() body: ImportEmploymentsRequest): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, ImportEmploymentsCommand>({
        commandName: 'employment.import-employments',
        rows: body.rows,
      }),
    );
  }
}
