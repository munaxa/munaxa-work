import type { ReactNode } from 'react';
import type { OrganizationTreeNode } from '@work/organization/contracts';

import { textIn, type Language } from './locale';

/**
 * The org chart, rendered as a nested list.
 *
 * A list rather than a canvas, deliberately. A nested `<ul>` is what a screen reader announces
 * as a hierarchy, it reflows on a phone, and it mirrors under RTL without a single coordinate
 * being recomputed — which a drawn chart does not. WCAG 2.2 AA is a requirement here, not a
 * nice-to-have.
 *
 * Indentation uses logical properties (`ps-*`, `border-s`), so the tree indents from the right
 * in Arabic and from the left in English with no conditional in the component. A `pl-4` here
 * would be a chart that reads backwards for half this product's users.
 *
 * Depth is not passed down and not capped. AD-003 says a structure may be as deep as it needs to
 * be, and a component that took a `level` prop would be the place somebody later added a limit.
 */

export interface StructureTreeProps {
  readonly nodes: readonly OrganizationTreeNode[];
  readonly language: Language;
}

export const StructureTree = ({ nodes, language }: StructureTreeProps): ReactNode => {
  if (nodes.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1">
      {nodes.map((node) => (
        <li key={node.unit.id} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 py-1">
            <span className="font-medium">{textIn(node.unit.name, language)}</span>
            <code className="text-xs opacity-60">{node.unit.code}</code>
            {node.unit.status === 'active' ? null : (
              <span className="text-xs opacity-60">({node.unit.status})</span>
            )}
          </div>
          {node.children.length === 0 ? null : (
            <div className="border-s ps-4">
              <StructureTree nodes={node.children} language={language} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
};
