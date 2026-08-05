# CQRS guide

## Why commands and queries are separate

A command changes state: it needs a transaction, raises events, and must be authorized against
the actor. A query does none of that, and will eventually read a projection rather than the
transactional tables. Keeping them apart is what makes it possible to move reads elsewhere later
without touching a handler.

## The pipeline

```text
send(command) ──► tenancy ──► authorization ──► validation ──► handler
```

The order is deliberate. An unauthorized caller is refused **before** validation runs, so they
learn nothing about whether their payload was well formed — an error that says "days must be
greater than zero" tells an attacker the field exists and the shape is right.

Tenancy comes first because a business operation with no tenant is a bug in the caller, not a
permission problem, and it must fail loudly rather than be refused politely.

## Writing a command

```ts
interface ApproveLeave extends Command {
  readonly commandName: 'leave.approve';
  readonly requestId: string;
  readonly days: number;
}
```

The name is a literal type, so a typo is a compile error rather than a `not_found` at runtime.

## Failure kinds

`HandlerFailure` is a closed union, so the API layer maps every one to Problem Details without a
default branch:

| Kind | Meaning | Becomes |
| ---- | ------- | ------- |
| `validation` | The request is malformed | 400, with the field failures |
| `forbidden` | The actor lacks the permission | 403, naming only the permission |
| `not_found` | No such thing, or no handler | 404 |
| `conflict` | Concurrent modification | 409 |
| `rejected` | A business rule said no | 422, with the reason |

`rejected` is the important one: a business rule refusing is a normal outcome, not an exception.
Insufficient leave balance is an answer, and the domain returns it as a value.

## Queries

Query handlers declare a permission and nothing else. They do not open transactions and do not
raise events. When a query becomes expensive, its answer moves to a projection and the handler
changes — no caller does.

## Testing a handler

```ts
const dispatcher = new Dispatcher(permitting('leave.approve'));
dispatcher.registerCommand(approveLeaveHandler);

const result = await inTestTenant(() => dispatcher.send(command));
```

`permitting(...)` grants exactly what is listed, which is how a permission test should read: it
proves the handler is refused without the permission, rather than proving a mock was called.
