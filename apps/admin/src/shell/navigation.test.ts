import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DESTINATIONS, NAVIGATION, isCurrent } from './navigation';
import { LANGUAGES, directionOf, otherThan, translator } from './locale';

/**
 * The navigation map, checked against the filesystem rather than against a description of it.
 *
 * A navigation item that leads nowhere is worse than one that is missing: the first is a promise
 * the product breaks on the click, the second is a screen somebody has not written yet. Before this
 * frame existed the portal had the opposite problem — fifteen screens and no way to reach any of
 * them — and the way to avoid trading one for the other is to assert that the two agree.
 */

describe('the navigation map', () => {
  it('names a real page for every destination', () => {
    for (const destination of DESTINATIONS) {
      const page = `src/app${destination.href}/page.tsx`;

      expect([destination.key, existsSync(page)]).toEqual([destination.key, true]);
    }
  });

  /**
   * The two destinations this portal deliberately keeps apart.
   *
   * `approvals` is what somebody is being asked to answer; `workflow` is how a tenant configures
   * approval routing. They were one screen — the queues were the last two sections of the
   * configuration page — and an approval somebody has to find at the bottom of a settings screen is
   * not work.
   */
  it('separates the approvals a person answers from the workflow they are routed by', () => {
    const keys = DESTINATIONS.map((destination) => destination.key);

    expect(keys).toContain('approvals');
    expect(keys).toContain('workflow');

    for (const language of LANGUAGES) {
      const t = translator(language);

      expect(t('admin.nav.approvals')).not.toBe(t('admin.nav.workflow'));
    }
  });

  it('uses each key once, and derives the href from it', () => {
    const keys = DESTINATIONS.map((destination) => destination.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const destination of DESTINATIONS) expect(destination.href).toBe(`/${destination.key}`);
  });

  it('translates every group and every destination in both languages', () => {
    for (const language of LANGUAGES) {
      const t = translator(language);

      for (const section of NAVIGATION) {
        const title = t(`admin.group.${section.key}`);

        expect([language, section.key, title]).not.toEqual([
          language,
          section.key,
          `admin.group.${section.key}`,
        ]);
      }
      for (const destination of DESTINATIONS) {
        const label = t(`admin.nav.${destination.key}`);

        expect([language, destination.key, label]).not.toEqual([
          language,
          destination.key,
          `admin.nav.${destination.key}`,
        ]);
      }
    }
  });

  /**
   * A detail page keeps its section marked as the current one.
   *
   * An exact match would leave `/employment/0190…` — the employee record — with no current item at
   * all, which reads as having navigated out of the application. A prefix match must still not
   * match a *sibling* whose path merely starts with the same letters.
   */
  it('marks the section a detail page belongs to, and only that section', () => {
    const employment = DESTINATIONS.find((entry) => entry.key === 'employment');
    const leave = DESTINATIONS.find((entry) => entry.key === 'leave');

    expect(employment).toBeDefined();
    expect(leave).toBeDefined();
    if (employment === undefined || leave === undefined) return;

    expect(isCurrent(employment, '/employment')).toBe(true);
    expect(isCurrent(employment, '/employment/01900000-0000-7000-8000-00000000e001')).toBe(true);
    expect(isCurrent(leave, '/employment/01900000-0000-7000-8000-00000000e001')).toBe(false);
    expect(isCurrent(employment, '/employments')).toBe(false);
    expect(isCurrent(employment, '/')).toBe(false);
  });
});

describe('the portal chrome', () => {
  it('binds direction to language, in both directions', () => {
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('ar')).toBe('rtl');
  });

  it('offers exactly the other language', () => {
    expect(otherThan('en')).toBe('ar');
    expect(otherThan('ar')).toBe('en');
  });

  it('returns the key itself when a catalogue is missing one, rather than an empty label', () => {
    expect(translator('en')('admin.nav.thereIsNoSuchScreen')).toBe('admin.nav.thereIsNoSuchScreen');
  });
});
