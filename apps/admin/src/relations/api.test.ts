import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadCase, loadCaseContext, loadEmploymentRelations } from './api';
import { EMPLOYMENT_A, VIOLATION_A, aViolation } from './relations.fixture';

/**
 * The composition layer: which questions the relations screens ask, and what they do when they get
 * no answer.
 *
 * The property that matters most is **scope**: Relations publishes no tenant-wide read of
 * disciplinary matters, and this layer must never widen one. Every request it sends is asserted to
 * carry its subject — the employment, the violation, or the employment-and-category pair — with
 * the tenant catalogue as the one subjectless read, because the catalogue names nobody.
 */

const SOURCE = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

/** Every path a Relations or Employment controller actually serves, read from the modules. */
const SERVED: readonly string[] = ['employment', 'relations'].flatMap((module) => {
  const directory = new URL(`../../../../packages/modules/${module}/src/api/`, import.meta.url);

  return readdirSync(directory)
    .filter((file) => file.endsWith('.controller.ts'))
    .flatMap((file) =>
      [
        ...readFileSync(new URL(file, directory), 'utf8').matchAll(
          /@Controller\(\{ path: '([^']+)'/g,
        ),
      ].map((match) => match[1] ?? ''),
    );
});

const asking = (): string[] => {
  const asked: string[] = [];

  vi.stubGlobal('fetch', (input: string) => {
    asked.push(input);
    return Promise.resolve(new Response('', { status: 401 }));
  });
  return asked;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what one employment’s relations record asks', () => {
  it('keys every scoped read on the employment it was given, and no other subject', () => {
    const asked = asking();

    return loadEmploymentRelations(EMPLOYMENT_A).then(() => {
      expect(asked).toHaveLength(3);
      for (const url of asked.filter((entry) => !entry.includes('/relations/categories'))) {
        expect(url).toContain(EMPLOYMENT_A);
      }
    });
  });

  it('keeps a refused list absent rather than empty, and a refused employment nameless', async () => {
    asking();

    const relations = await loadEmploymentRelations(EMPLOYMENT_A);

    expect(relations.violations).toBeUndefined();
    expect(relations.employment.kind).toBe('refused');
  });

  it('treats an unknown employment as missing, not as a refusal', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(new Response('', { status: input.includes('/employments/') ? 404 : 401 })),
    );

    const relations = await loadEmploymentRelations(EMPLOYMENT_A);

    expect(relations.employment.kind).toBe('missing');
  });
});

describe('what one case asks', () => {
  it('distinguishes a case that does not exist from one the caller may not read', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));
    expect((await loadCase(VIOLATION_A)).kind).toBe('missing');

    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 403 })));
    expect((await loadCase(VIOLATION_A)).kind).toBe('refused');
  });

  it('keys every read on the case, its employment-and-category, or the nameless catalogue', () => {
    const asked = asking();

    return loadCaseContext(aViolation()).then(() => {
      expect(asked).toHaveLength(6);
      for (const url of asked.filter((entry) => !entry.includes('/relations/categories'))) {
        const scoped =
          url.includes(VIOLATION_A) ||
          (url.includes(EMPLOYMENT_A) && url.includes('violationCategoryId='));

        expect([url, scoped]).toEqual([url, true]);
      }
    });
  });

  it('asks the repeat window as at the violation’s own conduct date, never today', () => {
    const asked = asking();

    return loadCaseContext(aViolation()).then(() => {
      const escalation = asked.find((url) => url.includes('/escalation'));

      expect(escalation).toContain('asAt=2026-05-04');
    });
  });

  it('reads “nothing issued” as the case’s empty state, not as a withheld one', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(new Response('', { status: input.endsWith('/action') ? 404 : 401 })),
    );

    const context = await loadCaseContext(aViolation());

    expect(context.action.kind).toBe('missing');
    expect(context.history).toBeUndefined();
  });

  it('never caches a page of one named person’s disciplinary record', async () => {
    const options: RequestInit[] = [];

    vi.stubGlobal('fetch', (_input: string, init: RequestInit) => {
      options.push(init);
      return Promise.resolve(new Response('', { status: 401 }));
    });

    await loadEmploymentRelations(EMPLOYMENT_A);
    await loadCaseContext(aViolation());

    expect(options.length).toBeGreaterThan(0);
    for (const init of options) expect(init.cache).toBe('no-store');
  });
});

describe('what the composition layer is allowed to touch', () => {
  it('imports every type from a published contract, never from a module’s internals', () => {
    const imports = [...SOURCE.matchAll(/from '(@work\/[^']+)'/g)].map((match) => match[1] ?? '');

    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      const published = specifier === '@work/config' || specifier.endsWith('/contracts');

      expect([specifier, published]).toEqual([specifier, true]);
    }
  });

  it('sends no write of any kind', () => {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE', 'method:']) {
      expect([verb, SOURCE.includes(verb)]).toEqual([verb, false]);
    }
  });

  it('asks only for paths a controller serves', () => {
    const asked = [...SOURCE.matchAll(/`\/(api\/v1\/)?([a-z][a-z-]*(?:\/[a-z][a-z-]*)*)/g)].map(
      (match) => match[2] ?? '',
    );

    expect(asked.length).toBeGreaterThan(0);
    for (const path of asked) {
      const served = SERVED.some(
        (controller) => path === controller || path.startsWith(`${controller}/`),
      );

      expect([path, served]).toEqual([path, true]);
    }
  });
});
