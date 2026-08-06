import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type { CreatePersonCommand } from '../application/person.use-case.js';
import type { ReadPerson, SearchPeople } from '../application/people-queries.js';
import type { ReadPersonProfile } from '../application/profile.query.js';

import { CreatePersonBody } from './people.dto.js';
import { PeopleDispatcher } from './people-dispatcher.js';
import { textFilters } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The register.
 *
 * Two things about this surface are the phase's claims made reachable.
 *
 * **`?asOf=` on every read.** A person's legal name has a history, so "who is this person" is a
 * question about a date. Omitting it means today; supplying it renders the name in force then
 * (ADR-0037).
 *
 * **A create may be refused with 409.** Duplicate detection runs before the write, and a caller
 * that has seen the candidates re-sends with `acknowledgedDuplicates`. The refusal names no value
 * that matched — a response echoing a national identifier would put one into a browser's history.
 */
@ApiTags('people')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such record in this tenant.' })
@Controller({ path: 'people', version: '1' })
export class PeopleController {
  public constructor(private readonly dispatcher: PeopleDispatcher) {}

  @Get()
  @ApiOperation({
    summary: 'Search the register by number, name, identifier, contact, tag or skill',
  })
  @ApiQuery({ name: 'term', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'identifierType', required: false })
  @ApiQuery({
    name: 'identifierValue',
    required: false,
    description: 'Digested before the query is issued. The value never reaches a query plan.',
  })
  @ApiQuery({ name: 'contactValue', required: false })
  @ApiQuery({ name: 'tagCode', required: false })
  @ApiQuery({ name: 'capabilityCode', required: false })
  @ApiQuery({ name: 'nationality', required: false })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiOkResponse({
    description:
      'A page of people, each redacted to what the caller may see. Sensitive fields are absent rather than null.',
  })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'people.search',
        ...textFilters(query),
        ...(query['asOf'] === undefined ? {} : { asOf: new Date(query['asOf']) }),
        ...(query['page'] === undefined ? {} : { page: Number(query['page']) }),
        ...(query['size'] === undefined ? {} : { size: Number(query['size']) }),
      } satisfies SearchPeople),
    );
  }

  @Get(':personId')
  @ApiOperation({ summary: 'Read a person as at a date' })
  @ApiQuery({ name: 'asOf', required: false })
  @ApiOkResponse({ description: 'The person, with the name in force on that date.' })
  public async read(
    @Param('personId') personId: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'people.read-person',
        personId,
        ...(asOf === undefined ? {} : { asOf: new Date(asOf) }),
      } satisfies ReadPerson),
    );
  }

  @Get(':personId/profile')
  @ApiOperation({ summary: 'Everything about a person the caller is entitled to see' })
  @ApiOkResponse({
    description:
      'Sections the caller may not read are absent and named in `withheld` — an empty list would assert the person holds none.',
  })
  public async profile(
    @Param('personId') personId: string,
    @Query('asOf') asOf?: string,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask({
        queryName: 'people.read-profile',
        personId,
        ...(asOf === undefined ? {} : { asOf: new Date(asOf) }),
      } satisfies ReadPersonProfile),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a person. Duplicate detection runs before the write (AD-001)' })
  @ApiConflictResponse({
    description:
      'The person may already exist, or the number is taken. Re-send with acknowledgedDuplicates to create anyway.',
  })
  @ApiOkResponse({ description: 'The created person, and how many duplicates were queued.' })
  public async create(@Body() body: CreatePersonBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send({
        commandName: 'people.create-person',
        personNumber: body.personNumber,
        legalName: { ...body.legalName },
        ...(body.preferredName === undefined ? {} : { preferredName: { ...body.preferredName } }),
        ...(body.dateOfBirth === undefined ? {} : { dateOfBirth: body.dateOfBirth }),
        ...(body.placeOfBirth === undefined ? {} : { placeOfBirth: body.placeOfBirth }),
        ...(body.genderCode === undefined ? {} : { genderCode: body.genderCode }),
        ...(body.maritalStatusCode === undefined
          ? {}
          : { maritalStatusCode: body.maritalStatusCode }),
        ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
        ...(body.effectiveFrom === undefined
          ? {}
          : { effectiveFrom: new Date(body.effectiveFrom) }),
        ...(body.acknowledgedDuplicates === undefined
          ? {}
          : { acknowledgedDuplicates: body.acknowledgedDuplicates }),
      } satisfies CreatePersonCommand),
    );
  }
}
