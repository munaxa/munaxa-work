import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

/**
 * What the result record shows while Payroll is being asked.
 *
 * A skeleton rather than a spinner, and one carrying no text: a placeholder where somebody's net pay
 * will be is the worst placeholder in the product.
 */
const Loading = (): ReactNode => (
  <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" aria-busy="true">
    <div className="h-8 w-44 animate-pulse rounded bg-muted" />
    <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />
    <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
    {Array.from({ length: 2 }, (_, index) => index).map((index) => (
      <Card key={index} className="flex flex-col gap-3 p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </Card>
    ))}
  </div>
);

export default Loading;
