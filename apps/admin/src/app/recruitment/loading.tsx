import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

/**
 * What the hiring workspace shows while Recruitment is being asked.
 *
 * A skeleton rather than a spinner because it holds the layout still: the four totals and the five
 * sections arrive in the same place and at the same size they occupy, so the page does not jump when
 * they do. It shows no placeholder figure — a number on a hiring screen is one somebody might act
 * on, and a fake one is worse than no one at all.
 */
const Loading = (): ReactNode => (
  <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" aria-busy="true">
    <div className="h-8 w-48 animate-pulse rounded bg-muted" />
    <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
    {Array.from({ length: 3 }, (_, index) => index).map((index) => (
      <Card key={index} className="flex flex-col gap-3 p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      </Card>
    ))}
  </div>
);

export default Loading;
