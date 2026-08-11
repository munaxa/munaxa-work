import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  DecideLetterCommand,
  RequestLetterCommand,
} from '../application/letter-request.use-case.js';
import type {
  ReadLettersReconciliation,
  ReadRequest,
  SearchRequests,
} from '../application/letters-queries.js';

import { DecideLetterBody, RequestLetterBody } from './letters.dto.js';
import { LettersDispatcher } from './letters-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * Requests and approval.
 *
 * `reconciliation` is declared before the `:letterRequestId` routes, because Nest resolves by
 * declaration order and a parameter segment declared first would swallow it.
 *
 * Authorization is **not** decided here. Each handler declares the permission it requires and the
 * kernel's pipeline enforces it — including the second gate on pay, which cannot be a route
 * decision: whether a letter may state a salary depends on the *template* the request names, and
 * only the handler knows that.
 */
@ApiTags('letters')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'letters/requests', version: '1' })
export class LetterRequestController {
  public constructor(private readonly dispatcher: LettersDispatcher) {}

  @Get('reconciliation')
  @ApiOperation({ summary: 'What reconciliation found. It reports; it repairs nothing' })
  public async reconciliation(): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadLettersReconciliation>({
        queryName: 'letters.reconciliation',
      }),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Search letter requests. Bounded' })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchRequests>({
        queryName: 'letters.requests',
        ...paged(query),
        ...optional(query, ['letterTemplateId', 'employmentId', 'personId', 'status']),
      }),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Request a letter. The template decides whether approval is needed' })
  public async request(@Body() body: RequestLetterBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, RequestLetterCommand>({
        commandName: 'letters.request',
        ...body,
      }),
    );
  }

  @Get(':letterRequestId')
  @ApiOperation({ summary: 'One request, its approval chain and the letter it produced' })
  public async read(@Param('letterRequestId') letterRequestId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadRequest>({
        queryName: 'letters.read-request',
        letterRequestId,
      }),
    );
  }

  @Post(':letterRequestId/decisions')
  @ApiOperation({ summary: 'Approve, reject or reverse. Self-approval is refused' })
  @ApiOkResponse({
    description:
      'The decider comes from the authenticated context, never from the body. A reversal does not ' +
      'erase what it reverses: the chain reads as the history it is.',
  })
  public async decide(
    @Param('letterRequestId') letterRequestId: string,
    @Body() body: DecideLetterBody,
  ): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.send<unknown, DecideLetterCommand>({
        commandName: 'letters.decide',
        letterRequestId,
        ...body,
      }),
    );
  }
}

/**
 * The filters a caller actually supplied.
 *
 * A key present with `undefined` is not the same as absent under `exactOptionalPropertyTypes`, and
 * a filter that arrived as `undefined` would narrow a search to rows whose column is literally
 * null. Dropping them here is what keeps an empty query string meaning "everything".
 */
const optional = (
  query: Record<string, string | undefined>,
  names: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    names
      .map((name) => [name, query[name]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
