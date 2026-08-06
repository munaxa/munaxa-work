import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type { ExportPeople, ImportPeopleCommand } from '../application/transfer.use-case.js';

import { ImportPeopleBody } from './profile.dto.js';
import { PeopleDispatcher } from './people-dispatcher.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Bulk transfer.
 *
 * An import is when a register acquires its duplicates, which is why every row goes through the
 * same `people.create-person` command an administrator uses rather than being written directly. A
 * faster import that wrote rows would bypass the check that is the whole point of AD-001.
 *
 * The export is deliberately narrower than a profile: it leaves the product, and the fields that
 * would make a leaked file catastrophic — identifier values, notes, addresses, dates of birth —
 * are not in it.
 */
@ApiTags('people')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'people', version: '1' })
export class TransferController {
  public constructor(private readonly dispatcher: PeopleDispatcher) {}

  @Post('import')
  @ApiOperation({
    summary: 'Bulk load. Every row goes through the same command an administrator uses',
  })
  @ApiOkResponse({ description: 'How many were created, skipped and refused, and why.' })
  public async importPeople(@Body() body: ImportPeopleBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.import',
        rows: body.rows.map((row) => ({
          personNumber: row.personNumber,
          legalName: { ...row.legalName },
          ...(row.preferredName === undefined ? {} : { preferredName: { ...row.preferredName } }),
          ...(row.dateOfBirth === undefined ? {} : { dateOfBirth: row.dateOfBirth }),
          ...(row.placeOfBirth === undefined ? {} : { placeOfBirth: row.placeOfBirth }),
          ...(row.genderCode === undefined ? {} : { genderCode: row.genderCode }),
          ...(row.maritalStatusCode === undefined
            ? {}
            : { maritalStatusCode: row.maritalStatusCode }),
        })),
        ...(body.acknowledgedDuplicates === undefined
          ? {}
          : { acknowledgedDuplicates: body.acknowledgedDuplicates }),
      } satisfies ImportPeopleCommand),
    );
  }

  @Get('export')
  @ApiOperation({
    summary:
      'Export the register. Deliberately narrower than a profile: no identifier values, notes or addresses',
  })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiOkResponse({ description: 'The register as at a date.' })
  public async exportPeople(@Query('asOf') asOf?: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'people.export',
        ...(asOf === undefined ? {} : { asOf: new Date(asOf) }),
      } satisfies ExportPeople),
    );
  }
}
