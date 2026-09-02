import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { browserCookies, signedIn } from '../test/setup';
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

  it('says the product writes nothing', async () => {
    const markup = await render();

    expect(markup).toContain(escaped(en('admin.notice.readOnly')));
  });

  it('shows a reader with no session the way in, not the workspace', async () => {
    // The one test here that is about who is looking rather than what is on the screen. It was
    // written when nobody could be signed in at all; now that somebody can be, the notice it
    // asserts belongs to the signed-out reader specifically.
    browserCookies();
    try {
      const markup = await render();

      expect(markup).toContain(escaped(en('admin.access.signedOut.title')));
      expect(markup).toContain(escaped(en('admin.access.signedOut.detail')));
      for (const destination of DESTINATIONS) {
        expect([destination.href, markup.includes(`href="${destination.href}`)]).toEqual([
          destination.href,
          false,
        ]);
      }
    } finally {
      signedIn();
    }
  });

  it('has no button, form or input: nothing here does nothing', async () => {
    const markup = (await render()).toLowerCase();

    for (const control of ['<form', '<button', '<input', '<select', 'onclick']) {
      expect([control, markup.includes(control)]).toEqual([control, false]);
    }
  });
});
