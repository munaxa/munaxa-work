import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { translator } from './locale';
import { ApprovalGroupsSection, GroupMembersSection } from './groups';
import { APPROVER, DEPUTY } from './views.fixture';
import { GROUP_ID, aGroup, aGroupDetail, anotherGroup } from './branches.fixture';

/**
 * The approval-group workspace, and the claim it must never make.
 *
 * A table of codes and bilingual names is exactly the shape a reader takes for a directory — so the
 * assertions here are as much about the words beside the table as about the table. A group is a
 * list somebody wrote down; it is not a role, a department, an organizational unit, a manager's
 * reports or a query against Identity, and every one of those readings is checked for and refused.
 */

const en = translator('en');
const ar = translator('ar');
const props = { t: en, language: 'en' } as const;

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

/** Headings, column headers and figure labels — where a word reads as a claim about the data. */
const labels = (markup: string): string =>
  [...markup.matchAll(/<(?:h1|h2|th|dt)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|th|dt)>/g)]
    .map((match) => match[1] ?? '')
    .join(' | ')
    .toLowerCase();

describe('the lists a tenant keeps', () => {
  it('renders each group with its code, its name in the reader’s language, and its row version', () => {
    const markup = html(
      <ApprovalGroupsSection {...props} groups={[aGroup(), anotherGroup()]} total={4000} />,
    );

    expect(markup).toContain('capital-approvers');
    expect(markup).toContain('finance-directors');
    expect(markup).toContain('Capital approvers');
    // The server's total beside the page, never the length of what arrived.
    expect(markup).toContain('2 / 4000');
  });

  it('renders the group name in Arabic without translating the tenant’s own code', () => {
    const markup = html(
      <ApprovalGroupsSection t={ar} language="ar" groups={[aGroup()]} total={1} />,
    );

    expect(markup).toContain('معتمدو النفقات');
    // A code is a tenant value. It is printed as it was stored, in both languages.
    expect(markup).toContain('capital-approvers');
    expect(markup).not.toContain('workflow.label.');
  });

  it('says in words that a group is an explicit list rather than a directory', () => {
    const markup = html(<ApprovalGroupsSection {...props} groups={[aGroup()]} total={1} />);

    expect(markup).toContain(escaped(en('workflow.notice.groupIsExplicitList')));
  });

  /**
   * The N+1 shape, refused in the markup rather than only in the request count.
   *
   * A member-count column is the reason somebody would add a detail request per row. There is no
   * such column on the listing, and the `api` suite proves the requests that would fill it are not
   * made.
   */
  it('has no member-count column on the listing, which is what a per-row read would fill', () => {
    const markup = html(
      <ApprovalGroupsSection {...props} groups={[aGroup(), anotherGroup()]} total={2} />,
    );

    expect(labels(markup)).not.toContain(en('workflow.label.memberCount').toLowerCase());
  });

  it('renders an empty state rather than a broken table', () => {
    const markup = html(<ApprovalGroupsSection {...props} groups={[]} total={0} />);

    expect(markup).toContain(escaped(en('workflow.notice.empty')));
  });
});

describe('who is on one list', () => {
  it('renders every membership on the group, in full, with the moment it was added', () => {
    const markup = html(<GroupMembersSection {...props} detail={aGroupDetail()} />);

    expect(markup).toContain(`>${APPROVER}<`);
    expect(markup).toContain(`>${DEPUTY}<`);
    // Pinned to UTC: the fixture's instant is half an hour before midnight on the 28th.
    expect(markup).toContain('28/02/2026');
    expect(markup).not.toContain('01/03/2026');
  });

  /**
   * A membership is never shortened, and on this screen that is the whole point.
   *
   * These identifiers are UUIDv7, so two memberships admitted on one afternoon share their first
   * eight characters. A list of two people rendered short is a list of the same person twice.
   */
  it('renders two memberships as two, not as one repeated', () => {
    const markup = html(<GroupMembersSection {...props} detail={aGroupDetail()} />);

    expect(APPROVER.slice(0, 8)).toBe(DEPUTY.slice(0, 8));
    expect(APPROVER).not.toBe(DEPUTY);
    expect(markup.indexOf(APPROVER)).not.toBe(markup.indexOf(DEPUTY));
  });

  it('shows the count of the list it received, and the group it belongs to', () => {
    const markup = html(<GroupMembersSection {...props} detail={aGroupDetail()} />);

    expect(markup).toContain('capital-approvers');
    // Two members, as an exact cell rather than a substring.
    expect(markup).toContain('>2<');
    expect(labels(markup)).toContain(en('workflow.label.memberCount').toLowerCase());
  });

  it('says that changing a list does not reach an approval already running', () => {
    const markup = html(<GroupMembersSection {...props} detail={aGroupDetail()} />);

    expect(markup).toContain(escaped(en('workflow.notice.groupIsSnapshotted')));
  });

  it('renders an empty state when no group was read', () => {
    const markup = html(<GroupMembersSection {...props} detail={undefined} />);

    expect(markup).toContain(escaped(en('workflow.notice.empty')));
    expect(markup).not.toContain(GROUP_ID);
  });
});

describe('what a group is not', () => {
  /**
   * The words that would turn a list into a directory.
   *
   * Scoped to headings, column headers and figure labels, which is where a word describes the data
   * beneath it. The explanatory notice legitimately uses several of them to say what a group is
   * *not*, and an assertion over the whole page would force the screen to stop explaining itself.
   */
  it('names no role, department, manager or directory anywhere it would be a claim', () => {
    const markup = [
      html(<ApprovalGroupsSection {...props} groups={[aGroup(), anotherGroup()]} total={2} />),
      html(<GroupMembersSection {...props} detail={aGroupDetail()} />),
    ].join('\n');

    for (const claim of [
      'role',
      'department',
      'organizational unit',
      'org unit',
      'manager',
      'team',
      'reports',
      'directory',
      'position',
      'employment',
      'dynamic',
      'owner',
      'status',
      'effective',
    ]) {
      expect([claim, labels(markup).includes(claim)]).toEqual([claim, false]);
    }
  });

  /** And no person's name is invented for a membership the API published as an identifier. */
  it('resolves no membership to a name', () => {
    const markup = html(<GroupMembersSection {...props} detail={aGroupDetail()} />);

    // Every membership cell is the identifier itself, character for character.
    for (const membership of aGroupDetail().members) {
      expect([membership.membershipId, markup.includes(`>${membership.membershipId}<`)]).toEqual([
        membership.membershipId,
        true,
      ]);
    }
  });

  it('offers nothing to click on either section', () => {
    const markup = [
      html(<ApprovalGroupsSection {...props} groups={[aGroup()]} total={1} />),
      html(<GroupMembersSection {...props} detail={aGroupDetail()} />),
    ]
      .join('\n')
      .toLowerCase();

    for (const control of [
      '<form',
      '<button',
      '<input',
      '<select',
      '<dialog',
      'href=',
      'onclick',
    ]) {
      expect([control, markup.includes(control)]).toEqual([control, false]);
    }
  });
});
