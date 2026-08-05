import { describe, expect, it } from 'vitest';

import { UnauthenticatedPort } from './authentication.js';

describe('UnauthenticatedPort', () => {
  const port = new UnauthenticatedPort();

  it('authenticates nobody, whatever is presented', async () => {
    expect(await port.authenticate()).toBeUndefined();
  });

  it('is the default because failing closed is the only safe default for a port we do not own', async () => {
    // The property under test is that there is no input at all — no header, no token, no
    // well-known development value — that turns this port into an authenticated principal.
    const attempts = [
      { scheme: 'Bearer', value: 'anything' },
      { scheme: 'Basic', value: 'YWRtaW46YWRtaW4=' },
      { scheme: 'X-Platform-User', value: '01920000-0000-7000-8000-000000000001' },
    ];

    for (const attempt of attempts) {
      expect(await port.authenticate(attempt)).toBeUndefined();
    }
  });
});
