import { DomainException } from '../errors/domain-exception.js';

/**
 * Translation catalogues and locale resolution.
 *
 * Every user-visible string resolves through here, and a missing key is loud rather than
 * cosmetic: returning the key itself puts `leave.request.submitted` on an employee's screen,
 * which is noticed, whereas returning an empty string produces a blank label that ships.
 *
 * Completeness is checked in CI, so a phase cannot be done with a language missing.
 */

export type Catalogue = Readonly<Record<string, string>>;

export interface LocaleSettings {
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly calendar: 'gregorian' | 'hijri';
  readonly timeZone: string;
}

/** Languages written right to left. Direction follows the language, never a user toggle. */
const RIGHT_TO_LEFT = new Set(['ar', 'he', 'fa', 'ur']);

export const directionOf = (language: string): 'ltr' | 'rtl' =>
  RIGHT_TO_LEFT.has(language.split('-')[0] ?? language) ? 'rtl' : 'ltr';

export class Translator {
  public constructor(
    private readonly catalogues: ReadonlyMap<string, Catalogue>,
    private readonly fallback: string,
  ) {}

  public translate(
    key: string,
    language: string,
    variables: Readonly<Record<string, string | number>> = {},
  ): string {
    const template =
      this.catalogues.get(language)?.[key] ?? this.catalogues.get(this.fallback)?.[key] ?? key;

    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.hasOwn(variables, name) ? String(variables[name]) : match,
    );
  }

  public has(key: string, language: string): boolean {
    return this.catalogues.get(language)?.[key] !== undefined;
  }

  /** Keys present in the fallback language but missing from another. CI fails on any. */
  public missingKeys(language: string): readonly string[] {
    const reference = this.catalogues.get(this.fallback);

    if (reference === undefined) {
      throw new DomainException('catalogue_missing_fallback', `No ${this.fallback} catalogue.`);
    }
    const target = this.catalogues.get(language) ?? {};
    return Object.keys(reference).filter((key) => target[key] === undefined);
  }
}
