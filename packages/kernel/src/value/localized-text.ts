import { DomainException } from '../errors/domain-exception.js';

/**
 * Text in every language a tenant uses.
 *
 * Modelled as a value rather than a string plus a translation lookup, because leave type names,
 * letter templates and survey questions are authored by the tenant, not by us — there is no
 * catalogue to look them up in. A phase cannot publish one of these with a language missing,
 * which is what stops an Arabic user meeting an English-only dropdown.
 */
export class LocalizedText {
  private constructor(private readonly values: ReadonlyMap<string, string>) {}

  public static of(values: Readonly<Record<string, string>>): LocalizedText {
    const entries = Object.entries(values).filter(([, text]) => text.trim() !== '');

    if (entries.length === 0) {
      throw new DomainException(
        'localized_text_empty',
        'Text must exist in at least one language.',
      );
    }
    return new LocalizedText(new Map(entries));
  }

  public get languages(): readonly string[] {
    return [...this.values.keys()];
  }

  public has(language: string): boolean {
    return this.values.has(language);
  }

  /** The text in a language, falling back to the tenant default and then to any language. */
  public in(language: string, fallback: string): string {
    return (
      this.values.get(language) ?? this.values.get(fallback) ?? [...this.values.values()][0] ?? ''
    );
  }

  /** True when every required language is present. Publication gates on this. */
  public isCompleteFor(required: readonly string[]): boolean {
    return required.every((language) => this.values.has(language));
  }

  public missingFrom(required: readonly string[]): readonly string[] {
    return required.filter((language) => !this.values.has(language));
  }

  public toJSON(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
}
