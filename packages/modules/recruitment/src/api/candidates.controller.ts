import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  AmendCandidateCommand,
  CreateCandidateCommand,
} from '../application/candidate.use-case.js';
import type {
  MatchCandidateToPeople,
  ReadCandidate,
  SearchCandidates,
} from '../application/recruitment-queries.js';

import { AmendCandidateBody, CreateCandidateBody } from './candidate.dto.js';
import { RecruitmentDispatcher } from './recruitment-dispatcher.js';
import { candidateFilters, paging } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Candidates: the people who might join.
 *
 * **Creating one creates no Person.** A speculative applicant who is never contacted leaves nothing
 * in the master registry of human identity, because they are not one of the tenant's people
 * (ADR-0044).
 *
 * **The match endpoint suggests and never acts.** It returns people who might already be this
 * candidate, for a human to decide: two people share a family email address more often than a
 * product designer expects, and a system that linked automatically would attach somebody's career to
 * their spouse.
 */
@ApiTags('recruitment')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@ApiNotFoundResponse({ description: 'No such candidate in this tenant.' })
@Controller({ path: 'recruitment/candidates', version: '1' })
export class CandidatesController {
  public constructor(private readonly dispatcher: RecruitmentDispatcher) {}

  @Get()
  @ApiOperation({ summary: 'Search candidates by number, name, address, telephone or skill' })
  @ApiOkResponse({ description: 'A page of candidates.' })
  public async search(@Query() query: Record<string, string>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchCandidates>({
        queryName: 'recruitment.search-candidates',
        ...candidateFilters(query),
        ...paging(query),
      }),
    );
  }

  @Get(':candidateId')
  @ApiOperation({ summary: 'One candidate, their profile and their applications' })
  public async read(@Param('candidateId') candidateId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadCandidate>({
        queryName: 'recruitment.read-candidate',
        candidateId,
      }),
    );
  }

  @Get(':candidateId/person-matches')
  @ApiOperation({
    summary: 'People who might already be this candidate. A suggestion, not an action',
  })
  @ApiOkResponse({
    description:
      'Nothing is linked by running this. The recruiter does not hold People’s read permission; the module holds it for the duration of the operation (ADR-0043).',
  })
  public async matches(@Param('candidateId') candidateId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, MatchCandidateToPeople>({
        queryName: 'recruitment.match-candidate',
        candidateId,
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a candidate. The number is generated' })
  @ApiCreatedResponse({ description: 'The candidate identifier and its generated number.' })
  @ApiConflictResponse({
    description:
      'That address is already a candidate. The create refuses rather than quietly updating the record it found.',
  })
  public async create(@Body() body: CreateCandidateBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, CreateCandidateCommand>({
        commandName: 'recruitment.create-candidate',
        ...body,
      }),
    );
  }

  @Post(':candidateId/amendment')
  @ApiOperation({ summary: 'Correct a candidate’s details' })
  public async amend(
    @Param('candidateId') candidateId: string,
    @Body() body: AmendCandidateBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, AmendCandidateCommand>({
        commandName: 'recruitment.amend-candidate',
        candidateId,
        ...body,
      }),
    );
  }
}
