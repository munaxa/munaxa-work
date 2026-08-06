import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  LegalEntityView,
  OrganizationTree,
  OrganizationUnitTypeView,
  TenantSettingsView,
} from '@work/organization/contracts';

import { textIn, type Language } from './locale';
import { StructureTree } from './structure-tree';

/**
 * The sections of the organization screen, one component each.
 *
 * Split from the page so neither outgrows the size and complexity budgets the standards set —
 * and because each of these is the answer to a different question, which is exactly the seam a
 * reader wants.
 *
 * Every one takes a translator rather than importing one: which language a reader wants is the
 * page's decision, made once from the request, not something four components each work out.
 */

export type Translate = (key: string) => string;

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/**
 * What the structure card is showing: the tree, or the empty state.
 *
 * Decided before the JSX rather than inside it, because a branch per condition inline is how a
 * component acquires four nested ternaries that nobody can read — and here the three cases
 * (unreachable API, empty organization, real structure) all render the same shape.
 */
const structureStateOf = (
  tree: OrganizationTree | undefined,
  unavailable: boolean,
): 'empty' | 'tree' => (unavailable || (tree?.roots.length ?? 0) === 0 ? 'empty' : 'tree');

export const StructureSection = ({
  t,
  language,
  tree,
  unavailable,
  asOf,
}: SectionProps & {
  readonly tree: OrganizationTree | undefined;
  readonly unavailable: boolean;
  readonly asOf: string | undefined;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-medium">{t('organization.label.units')}</h2>
      <span className="text-xs opacity-60">
        {t('organization.label.asOf')}: {asOf ?? String(tree?.asOf ?? '—')}
      </span>
    </div>
    <p className="text-sm opacity-70">{t('organization.hint.historyPreserved')}</p>
    {structureStateOf(tree, unavailable) === 'empty' ? (
      <p className="text-sm opacity-70">{t('organization.empty.hierarchy')}</p>
    ) : (
      <StructureTree nodes={tree?.roots ?? []} language={language} />
    )}
    {(tree?.unplacedUnitIds.length ?? 0) === 0 ? null : (
      <p className="text-sm opacity-70">{t('organization.empty.unplaced')}</p>
    )}
  </Card>
);

export const UnitTypesSection = ({
  t,
  language,
  unitTypes,
}: SectionProps & { readonly unitTypes: readonly OrganizationUnitTypeView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('organization.label.unitTypes')}</h2>
    <p className="text-sm opacity-70">{t('organization.hint.standardUnitTypes')}</p>
    {unitTypes.length === 0 ? (
      <p className="text-sm opacity-70">{t('organization.empty.unitTypes')}</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {unitTypes.map((type) => (
          <li key={type.id} className="flex items-baseline gap-2">
            <span>{textIn(type.name, language)}</span>
            <code className="text-xs opacity-60">{type.code}</code>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const LegalEntitiesSection = ({
  t,
  language,
  legalEntities,
}: SectionProps & { readonly legalEntities: readonly LegalEntityView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('organization.label.legalEntity')}</h2>
    {/* The sentence that explains why one organization can show two countries on this screen. */}
    <p className="text-sm opacity-70">{t('organization.hint.countryFromLegalEntity')}</p>
    {legalEntities.length === 0 ? (
      <p className="text-sm opacity-70">{t('organization.empty.legalEntities')}</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {legalEntities.map((entity) => (
          <li key={entity.id} className="flex items-baseline gap-2">
            <span>{textIn(entity.registeredName, language)}</span>
            <span className="text-xs opacity-60">
              {entity.countryCode} · {entity.currencyCode}
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const SettingsSection = ({
  t,
  settings,
}: {
  readonly t: Translate;
  readonly settings: TenantSettingsView | undefined;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('organization.label.settings')}</h2>
    {settings === undefined ? (
      <p className="text-sm opacity-70">{t('organization.empty.settings')}</p>
    ) : (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="opacity-70">{t('organization.label.language')}</dt>
        <dd>{settings.language}</dd>
        <dt className="opacity-70">{t('organization.label.calendar')}</dt>
        <dd>{settings.calendar}</dd>
        <dt className="opacity-70">{t('organization.label.timeZone')}</dt>
        <dd>{settings.timeZone}</dd>
        <dt className="opacity-70">{t('organization.label.numerals')}</dt>
        <dd>{settings.numerals}</dd>
        <dt className="opacity-70">{t('organization.label.invitationValidityDays')}</dt>
        <dd>{settings.invitationValidityDays}</dd>
      </dl>
    )}
  </Card>
);
