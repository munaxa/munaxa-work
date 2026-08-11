import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type {
  ReadIssuedLetter,
  SearchIssued,
  VerifyLetter,
} from '../application/letters-queries.js';

import { VerifyLetterBody } from './letters.dto.js';
import { LettersDispatcher } from './letters-dispatcher.js';
import { paged } from './search-filters.js';
import { unwrapOrThrow } from './handler-result.js';

/**
 * The register of issued letters, and the third-party check.
 *
 * Two things on this controller are worth reading twice.
 *
 * **The register listing carries no substituted values and never the verification token.** A list
 * that carried the values would put a salary figure in front of everyone who may see the register,
 * and one that carried tokens would hand every reader the means to verify letters they have no
 * business verifying. Opening a single letter is a separate route.
 *
 * **Verification is a `POST` that takes the token in the body**, not a `GET` with it in the path. A
 * token in a URL ends up in a proxy log, a browser history and a referrer header — and this token
 * is the whole of the credential.
 *
 * It declares `letter.verify` rather than running unauthenticated. AD-006 describes a check a third
 * party performs and a bank clerk has no account, but every read in this product resolves a tenant
 * before it reaches a row and row-level security has no anonymous cross-tenant path. The
 * **anonymous public route is `NOT VERIFIED`**; what it would sit in front of is built and behaves
 * correctly.
 */
@ApiTags('letters')
@ApiForbiddenResponse({ description: 'The caller lacks the permission the operation requires.' })
@Controller({ path: 'letters/issued', version: '1' })
export class IssuedLetterController {
  public constructor(private readonly dispatcher: LettersDispatcher) {}

  @Post('verification')
  @ApiOperation({ summary: 'Confirm a letter is genuine, and disclose nothing else' })
  @ApiOkResponse({
    description:
      'A right token returns the reference, the issue date in both calendars and whether the ' +
      'letter has been superseded. **No name, no employer, no salary, no purpose.** A wrong token ' +
      'returns genuine: false and nothing else — not "no such letter", which over enough attempts ' +
      'would let somebody enumerate the register.',
  })
  public async verify(@Body() body: VerifyLetterBody): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, VerifyLetter>({
        queryName: 'letters.verify',
        ...body,
      }),
    );
  }

  @Get()
  @ApiOperation({ summary: 'The letter register. Bounded' })
  @ApiOkResponse({
    description: 'Carries no substituted values and never a verification token.',
  })
  public async search(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, SearchIssued>({
        queryName: 'letters.issued',
        ...paged(query),
        ...optional(query, ['letterTemplateId', 'employmentId', 'personId']),
      }),
    );
  }

  @Get(':issuedLetterId')
  @ApiOperation({ summary: 'One issued letter, including what it said' })
  @ApiOkResponse({
    description:
      'The frozen snapshot: the substituted values and the version of each source they came from. ' +
      'A March certificate still reads March salary after April raise, because nothing re-reads a ' +
      'source after issue.',
  })
  public async read(@Param('issuedLetterId') issuedLetterId: string): Promise<unknown> {
    return unwrapOrThrow(
      await this.dispatcher.ask<unknown, ReadIssuedLetter>({
        queryName: 'letters.read-issued',
        issuedLetterId,
      }),
    );
  }
}

/** The filters a caller actually supplied; see `letter.controller.ts` for why they are dropped. */
const optional = (
  query: Record<string, string | undefined>,
  names: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    names
      .map((name) => [name, query[name]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
