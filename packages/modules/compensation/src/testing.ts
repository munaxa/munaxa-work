// The module's test doubles, behind their own entry point.
//
// These are fakes: in-memory stands-in for the ports this module depends on, written so another
// module's tests can exercise a real use case without standing up a real neighbour. They are not
// exported from `index.ts`, and that is the whole point of this file — a barrel that exports a fake
// puts it in the dependency graph of the running service, which is how `@work/testing` ended up a
// runtime requirement of the API and how a fake became one substitution away from serving real
// requests. Test code is reachable from tests and from nowhere else.

export {
  FakeEmployment,
  FakeOrganization,
  FixedClock,
} from './application/compensation-test-harness.js';
