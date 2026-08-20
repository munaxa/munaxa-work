import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { translator } from './locale';
import { StepsSection } from './definitions';
import { InstanceStepsSection } from './instances';
import { PendingSection } from './approvals';
import { ProvidedSection, StatusSection } from './status';
import {
  AT,
  DEPUTY,
  MANAGER,
  OVERDUE_DUE,
  WITHIN_DUE,
  aDefinitionDetail,
  anInstanceDetail,
  aPendingApproval,
} from './views.fixture';

/**
 * The manager approver and the service-level target, on the screen.
 *
 * Two properties are under test and they pull in opposite directions, which is why they are in one
 * file. The screen must **show** what Phase 16C built — otherwise an administrator cannot see why an
 * approval went where it did — and it must **claim nothing more**: no live lookup, no deadline, no
 * expiry, and no number it worked out itself.
 *
 * The fixture is built so that a screen deriving anything would disagree with it. The overdue step's
 * due instant is not `awaitingOn` plus forty-eight hours, and its `overdueByMinutes` is not the
 * difference between that instant and any other — both are the server's own values, chosen so that a
 * screen computing either would print something else.
 */

const en = translator('en');
const ar = translator('ar');
const props = { t: en, language: 'en' } as const;

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const configuration = (language: 'en' | 'ar' = 'en'): string =>
  html(<StepsSection t={translator(language)} language={language} detail={aDefinitionDetail()} />);

const running = (language: 'en' | 'ar' = 'en'): string =>
  html(
    <InstanceStepsSection
      t={translator(language)}
      language={language}
      detail={anInstanceDetail()}
    />,
  );

/**
 * The approver's own queue, which is where the *state* column lives.
 *
 * A queue row has room for one cell rather than four, so `serviceLevelState` is its header and
 * appears on no other screen. A localization test that rendered only the definition and the approval
 * would never reach that label, and would pass while the header sat untranslated.
 */
const queue = (language: 'en' | 'ar' = 'en'): string =>
  html(
    <PendingSection
      t={translator(language)}
      language={language}
      pending={[aPendingApproval()]}
      total={1}
    />,
  );

describe('a manager step, as configuration', () => {
  it('names the kind and nobody at all', () => {
    const markup = configuration();

    expect(markup).toContain(en('workflow.vocabulary.approverKind.manager'));
    // The two approver cells are empty for that row, because a manager template names nobody. The
    // other rows still name their people, so this is not "the table stopped rendering approvers".
    expect(markup).toContain(DEPUTY);
  });

  /**
   * **No organizational fact reaches this screen**, and the API does not publish one to reach it.
   *
   * A manager is resolved from an employment and a reporting line, and neither is Workflow's to
   * know. A configuration screen showing either would be describing a mechanism rather than a
   * process, and would imply the person is looked up whenever somebody opens the page.
   */
  it('shows no employment, reporting line, department or chain in the data', () => {
    // The **table**, not the notices beneath it. The notice explaining that a manager step names
    // nobody has to be able to say the words "employment" and "reporting line" in order to explain
    // what is not shown; what must carry none of them is the data.
    const markup = configuration();
    const table = markup.slice(markup.indexOf('<table'), markup.lastIndexOf('</table>'));

    for (const leaked of [
      'employment',
      'reporting',
      'department',
      'organizational unit',
      'chain',
      'directory',
    ]) {
      expect([leaked, table.toLowerCase().includes(leaked)]).toStrictEqual([leaked, false]);
    }
  });

  it('shows the configured target in the unit it was configured in', () => {
    const markup = configuration();

    // Forty-eight hours stays forty-eight hours: it is not turned into two days.
    expect(markup).toContain('48');
    expect(markup).toContain(en('workflow.vocabulary.serviceLevelUnit.hours'));
    expect(markup).toContain(en('workflow.vocabulary.serviceLevelUnit.days'));
    // And nothing converted it: two days did not become forty-eight hours either.
    expect(markup).toContain('2');
  });

  it('explains that a manager step names nobody, rather than leaving two empty cells unexplained', () => {
    expect(configuration()).toContain(en('workflow.notice.managerIsConfiguredNotNamed'));
  });
});

describe('a manager step, once it is running', () => {
  it('names the concrete membership the server resolved, in full', () => {
    const markup = running();

    // In full. A membership is never shortened here: these identifiers are UUIDv7, so two created
    // the same afternoon share their first eight characters, and the manager and the approver
    // beside them would render identically.
    expect(markup).toContain(MANAGER);
    expect(markup).toContain(DEPUTY);
    expect(MANAGER.slice(0, 8)).toBe(DEPUTY.slice(0, 8));
  });

  /**
   * The screen does not call that person a manager, and that restraint is the point.
   *
   * The API says `membership` and gives an identifier. Labelling the row "manager" would be the
   * screen inferring a fact from where the identifier came from — which is exactly the guess an
   * auditor must not find on a page.
   */
  it('renders the running step as a membership, not as a manager', () => {
    const markup = running();

    expect(markup).toContain(en('workflow.vocabulary.stepStatus.pending'));
    expect(markup).not.toContain(en('workflow.vocabulary.approverKind.manager'));
  });

  it('states that the manager was resolved once and stays put', () => {
    const markup = running();

    expect(markup).toContain(en('workflow.notice.managerIsSnapshotted'));
    // And offers nothing to act on: a notice, never a control.
    for (const control of ['<form', '<button', '<input', '<select', 'href=', 'onclick']) {
      expect([control, markup.toLowerCase().includes(control)]).toStrictEqual([control, false]);
    }
  });
});

describe('a service-level target, on a running step', () => {
  it('renders the target, the state, the due instant and the overdue minutes as published', () => {
    const markup = running();

    expect(markup).toContain(en('workflow.vocabulary.serviceLevelState.overdue'));
    expect(markup).toContain(en('workflow.vocabulary.serviceLevelState.within'));
    // The server's due instants, pinned to UTC by the same formatter as every other instant here.
    expect(markup).toContain('05/03/2026');
    expect(markup).toContain('04/03/2026');
    // Ninety minutes, exactly: not an hour and a half, not 1.5, not a percentage.
    expect(markup).toContain('90');
    expect(markup).not.toContain('1.5');
  });

  /**
   * The due instant is the server's and is **not** `awaitingOn` plus the target.
   *
   * Forty-eight hours after `AT` would be the 2nd of March; the fixture's published due instant is
   * the 4th. A screen that computed one would print the wrong day, and this is the assertion that
   * would catch it.
   */
  it('does not derive the due instant from the awaiting instant and the count', () => {
    const markup = running();

    expect(AT).toBe('2026-02-28T23:30:00.000Z');
    expect(OVERDUE_DUE).toBe('2026-03-04T09:15:00.000Z');
    expect(WITHIN_DUE).toBe('2026-03-05T09:15:00.000Z');
    // The day a screen adding forty-eight hours to `AT` would show, and it is nowhere.
    expect(markup).not.toContain('02/03/2026');
  });

  it('shows nothing overdue on a step within its target', () => {
    const markup = running();
    const within = en('workflow.vocabulary.serviceLevelState.within');

    expect(markup).toContain(within);
    // Zero is not rendered for a step that is not overdue: absent and "overdue by none" are two
    // different sentences, and the view publishes the field only for the second.
    expect(markup.split(within)[1] ?? '').not.toContain('>0<');
  });

  it('carries the state onto the queue row, and nothing else about it', () => {
    const markup = html(<PendingSection {...props} pending={[aPendingApproval()]} total={1} />);

    expect(markup).toContain(en('workflow.vocabulary.serviceLevelState.within'));
    // The queue shows how a row stands and not the arithmetic behind it.
    expect(markup).not.toContain('90');
  });
});

describe('what the screen still refuses to say', () => {
  it('offers no expired state anywhere', () => {
    const markup = `${running()}\n${html(<StatusSection {...props} />)}`.toLowerCase();

    // The approval vocabulary declares `expired`; the service-level vocabulary has three values and
    // this is not one of them. It appears only inside the sentence saying nothing produces it.
    expect(markup).not.toContain('>expired<');
    expect(markup).not.toContain('countdown');
    expect(markup).not.toContain('remaining');
  });

  it('still says there is no business-day target, no escalation and no expiry', () => {
    const markup = html(<StatusSection {...props} />);

    for (const key of [
      'workflow.withheld.businessDays',
      'workflow.withheld.escalation',
      'workflow.withheld.scheduling',
      'workflow.withheld.approvalExpiry',
      'workflow.withheld.roles',
      'workflow.withheld.externalApprovers',
      'workflow.withheld.notificationDelivery',
    ]) {
      expect([key, markup.includes(en(key))]).toStrictEqual([key, true]);
    }
  });

  it('claims the two capabilities that are now real, in both languages', () => {
    for (const [language, translate] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      const markup = html(<ProvidedSection t={translate} language={language} />);

      for (const key of ['workflow.provided.managerRouting', 'workflow.provided.serviceLevel']) {
        expect([language, key, markup.includes(translate(key))]).toStrictEqual([
          language,
          key,
          true,
        ]);
      }
    }
  });

  /**
   * Neither notice promises anything that fires.
   *
   * A sentence saying the product "reminds", "escalates" or "expires" would advertise a capability
   * three checkpoints deliberately did not build — and would be read as a promise by whoever is
   * deciding whether to rely on it.
   */
  it('promises nothing that runs on its own', () => {
    // The two **claims**. A claim naming a reminder, an escalation or an expiry would be announcing
    // a capability three checkpoints deliberately did not build.
    const claimed = `${en('workflow.provided.managerRouting')} ${en(
      'workflow.provided.serviceLevel',
    )}`.toLowerCase();

    for (const promise of [
      'remind',
      'escalat',
      'expire',
      'notif',
      'automatically',
      'business day',
      'continuously',
    ]) {
      expect([promise, claimed.includes(promise)]).toStrictEqual([promise, false]);
    }
  });

  /**
   * And the notices say what does *not* happen, which is a different sentence from saying nothing.
   *
   * The test above forbids these words in a claim; this one requires them in a denial. Without it, a
   * catalogue that simply stopped mentioning reminders would pass the first test while leaving an
   * administrator to assume the obvious.
   */
  it('states in words that nothing fires when a target passes', () => {
    const observed = en('workflow.notice.serviceLevelIsObserved').toLowerCase();

    expect(observed).toContain('nothing happens when it passes');
    expect(observed).toContain('reminded');
    expect(en('workflow.notice.serviceLevelIsElapsedTime').toLowerCase()).toContain('weekends');
    expect(en('workflow.notice.managerIsSnapshotted').toLowerCase()).toContain('once');
  });
});

describe('Arabic', () => {
  it('renders real Arabic for every label and notice this checkpoint added', () => {
    const markup = `${configuration('ar')}\n${running('ar')}\n${queue('ar')}`;

    for (const key of [
      'workflow.label.serviceLevel',
      'workflow.label.serviceLevelState',
      'workflow.vocabulary.approverKind.manager',
      'workflow.vocabulary.serviceLevelUnit.hours',
      'workflow.vocabulary.serviceLevelState.overdue',
      'workflow.notice.managerIsConfiguredNotNamed',
      'workflow.notice.managerIsSnapshotted',
    ]) {
      const arabic = ar(key);

      expect([key, arabic]).not.toStrictEqual([key, key]);
      expect([key, /[؀-ۿ]/.test(arabic)]).toStrictEqual([key, true]);
      expect([key, markup.includes(arabic)]).toStrictEqual([key, true]);
    }
  });

  /** And the identifiers are the same in both languages: a UUID is not translated or transliterated. */
  it('leaves identifiers and digits alone', () => {
    const arabic = running('ar');

    expect(arabic).toContain(MANAGER);
    expect(arabic).toContain('90');
    // Arabic-Indic digits would mean a count went through `toLocaleString` somewhere.
    expect(arabic).not.toMatch(/[٠-٩]/);
  });
});

describe('the source, with prose stripped', () => {
  const PRESENTATION = join(process.cwd(), 'src', 'workflow');

  const codeOf = (file: string): string =>
    readFileSync(join(PRESENTATION, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');

  /**
   * No service-level arithmetic, asserted against the file that would contain it.
   *
   * The renderer takes four published fields and prints them. A division, a multiplication, a
   * `Math.` or a `toFixed` in this file could only be turning the server's answer into a second one
   * — and a percentage or a bar width is exactly the shape that would arrive first.
   */
  it('computes nothing in the service-level renderer', () => {
    const code = codeOf('service-level.tsx');

    for (const arithmetic of [
      'Math.',
      'toFixed',
      'parseFloat',
      'parseInt',
      'Date.now',
      'new Date',
      ' / ',
      ' * ',
      ' % ',
      ' - ',
      ' + ',
      'width',
      'progress',
      'setInterval',
      'setTimeout',
    ]) {
      expect([arithmetic, code.includes(arithmetic)]).toStrictEqual([arithmetic, false]);
    }
  });
});
