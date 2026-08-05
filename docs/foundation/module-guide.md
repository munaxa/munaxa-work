# Module architecture guide

How to add a business module. Phase 2 creates the first one; this is the shape it and every
module after it follows.

## Structure

```text
packages/modules/<module>/
├── domain/           business rules — no framework, no ORM, no transport
├── application/      use cases: command and query handlers
├── infrastructure/   repositories and adapters — the only place a driver appears
├── contracts/        the public surface other modules may depend on
└── api/             transport: controllers, DTOs, OpenAPI
```

Layers live inside a module, never above it (ADR-0023). A module is the unit that could one day
be extracted to a service, and that is only true if everything it needs is inside it.

## What crosses a boundary

Exactly three things, and nothing else:

| Crossing | Use |
| -------- | --- |
| Asking another module to do something | Its **application service** |
| Reading another module's data | Its **public contracts** |
| Reacting to something that happened | Its **domain events** |

Its repositories, its tables and its Prisma client are private. The lint layer enforces this;
it is not a convention.

## Registering a module

A module declares what it offers and the registry derives the rest — nothing is registered by
hand, because a permission that exists in code but not in the administration screen is invisible
until a customer finds it.

```ts
export const leaveModule: WorkModule = {
  name: 'leave',
  commands: [approveLeaveHandler, cancelLeaveHandler],
  queries: [leaveBalanceHandler],
  eventHandlers: [onEmploymentTerminated],
  navigation: [{ key: 'leave', path: '/leave', permission: 'leave.read', order: 20 }],
  health: [{ name: 'leave.accrual-job', check: () => accrualJob.status() }],
};
```

Permissions come from the handlers that declare them. Navigation is ordered across modules.
Health checks are collected into `/health`.

## A command handler

```ts
export const approveLeaveHandler: CommandHandler<ApproveLeave, LeaveApproved> = {
  commandName: 'leave.approve',
  permission: 'leave.approve',                    // declared, never checked inside
  validate: (command) =>
    command.days > 0 ? [] : [{ field: 'days', message: 'must be greater than zero' }],
  handle: async (command) =>
    unitOfWork.execute(async (transaction) => {
      const request = await repository.load(transaction, command.requestId);
      const outcome = request.approve(command.approver);   // returns Result, does not throw
      if (!outcome.ok) return rejected(outcome.error.reason);

      await repository.save(transaction, request);
      transaction.collect(request.pullEvents());
      return success(outcome.value);
    }),
};
```

The handler never checks a permission, never opens a transaction by hand, never publishes an
event, and never filters by tenant. All four are the pipeline's and the Unit of Work's job, and
a handler that had to remember them would one day forget.

## Ownership

Every concept has one owner, recorded in [`DOMAIN_OWNERSHIP.md`](../DOMAIN_OWNERSHIP.md). A
module that finds a concept already owned consumes it — it never re-owns the data. Two modules
that both believe they own "employment status" produce two answers, and no amount of testing
reconciles them afterwards.

## What a module must ship

Everything in [`00A_PHASE_SPECIFICATION_TEMPLATE.md`](../../work%20prompts/00A_PHASE_SPECIFICATION_TEMPLATE.md):
aggregates with stated invariants, a state machine, versioned events, application services,
contracts, the API surface, permissions, tables with indexes, projections, configuration, and
the full test matrix including tenant isolation per entity.
