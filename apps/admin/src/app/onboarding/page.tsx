import type { ReactNode } from 'react';

import { loadOnboarding } from '../../onboarding/api';
import { directionOf, isLanguage, translator, type Language } from '../../onboarding/locale';
import {
  AwaitingSection,
  BoundariesSection,
  OnboardingsSection,
  OverdueSection,
  PlansSection,
} from '../../onboarding/sections';

/**
 * The onboarding administration screen.
 *
 * Presentation only: it consumes the module's published contracts and the API, and holds no business
 * logic of its own — no rule about when an onboarding may complete, no idea what makes a task
 * overdue. Those live in the domain and the application service, and a screen that reimplemented
 * them would be a second, weaker answer to a question the API already decided.
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **It is read-only**, consistent with the organization, people, employment and recruitment screens.
 * Every mutation goes through the API; the write screens are Phase 18/19's, and building them only
 * here would make Onboarding the one module with them. That includes reconciliation: the awaiting
 * list is shown, and the `POST` that acts on it is an operator's or a scheduler's.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const OnboardingPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const onboarding = await loadOnboarding();

  return (
    <main
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('onboarding.label.onboarding')}</h1>
      </header>

      <OnboardingsSection
        t={t}
        language={language}
        onboardings={onboarding.onboardings}
        unavailable={onboarding.unavailable}
      />
      <AwaitingSection t={t} language={language} awaiting={onboarding.awaiting} />
      <OverdueSection t={t} language={language} overdue={onboarding.overdue} />
      <PlansSection t={t} language={language} plans={onboarding.plans} />
      <BoundariesSection t={t} language={language} />
    </main>
  );
};

export default OnboardingPage;
