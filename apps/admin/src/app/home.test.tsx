import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { translator } from '../shell/locale';
import { DESTINATIONS } from '../shell/navigation';

import homePage from './page';

/**
 * The home screen, which used to be a card with a `Continue` button that continued to nothing.
 *
 * A control on the first screen anybody sees that does not do what it appears to do is the worst
 * place in a product to have one, and it was the only interactive element the portal had. What
 * replaced it has to actually reach every screen, in both languages — so that is what is asserted.
 */

const en = translator('en');
const ar = translator('ar');

const render = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await homePage({
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

describe('the home screen', () => {
  it('links to every screen the portal has', async () => {
    const markup = await render();

    for (const destination of DESTINATIONS) {
      expect([destination.key, markup.includes(`href="${destination.href}?lang=en"`)]).toEqual([
        destination.key,
        true,
      ]);
      expect([destination.key, markup.includes(en(`admin.nav.${destination.key}`))]).toEqual([
        destination.key,
        true,
      ]);
    }
  });

  it('carries the reader’s language into every link', async () => {
    const markup = await render('ar');

    expect(markup).toContain('href="/people?lang=ar"');
    expect(markup).toContain(ar('admin.nav.people'));
  });

  it('falls back to the reference language rather than failing on an unknown one', async () => {
    const markup = await render('fr');

    expect(markup).toContain('href="/people?lang=en"');
  });

  it('says the product writes nothing and that nobody is signed in', async () => {
    const markup = await render();

    expect(markup).toContain(escaped(en('admin.notice.readOnly')));
    expect(markup).toContain(escaped(en('admin.notice.notSignedIn')));
  });

  it('has no button, form or input: nothing here does nothing', async () => {
    const markup = (await render()).toLowerCase();

    for (const control of ['<form', '<button', '<input', '<select', 'onclick']) {
      expect([control, markup.includes(control)]).toEqual([control, false]);
    }
  });
});
