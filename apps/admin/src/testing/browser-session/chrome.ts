import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A real Chrome, driven over the DevTools protocol with nothing but Node's built-ins.
 *
 * Why not Playwright: this repository has no browser-test dependency, and adding one means a new
 * package, a lockfile change and a browser download in CI. A GitHub-hosted Ubuntu runner already
 * has Google Chrome installed, and Node 22 has `fetch` and `WebSocket`, which is all the protocol
 * needs. The test fails, never skips, when no Chrome is found: a browser test that quietly does not
 * run is a browser test nobody has.
 */

const CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export const findChrome = (): string => {
  const found = CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`No Chrome found for the browser test. Looked in: ${CANDIDATES.join(', ')}`);
  }
  return found;
};

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Waits for Chrome to write the port it chose, which it does once DevTools is listening. */
const devToolsPort = async (profile: string): Promise<number> => {
  const file = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await pause(100);
  }
  throw new Error('Chrome did not start its DevTools endpoint.');
};

export interface Browser {
  readonly port: number;
  close(): void;
}

export const launchChrome = async (): Promise<Browser> => {
  const profile = mkdtempSync(join(tmpdir(), 'work-admin-browser-'));
  const chrome: ChildProcess = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      // A throwaway profile visiting one local test server. The sandbox is unavailable to an
      // unprivileged process on current Ubuntu runners, and nothing here is untrusted content.
      '--no-sandbox',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const port = await devToolsPort(profile);

  return {
    port,
    close: () => {
      chrome.kill('SIGKILL');
      rmSync(profile, { recursive: true, force: true });
    },
  };
};

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
}

/** One tab, and the protocol commands the session test needs. */
export class Page {
  private next = 1;
  private readonly pending = new Map<number, Pending>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event: MessageEvent) => {
      this.settle(String(event.data));
    });
  }

  public static async open(browser: Browser): Promise<Page> {
    const target = (await (
      await fetch(`http://127.0.0.1:${browser.port}/json/new?about:blank`, { method: 'PUT' })
    ).json()) as { readonly webSocketDebuggerUrl: string };
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error('Could not connect to the Chrome tab.'));
      });
    });
    const page = new Page(socket);
    await page.send('Page.enable');
    await page.send('Network.enable');
    return page;
  }

  public send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.next;
    this.next += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluates an expression in the page and returns its value. */
  public async evaluate<TValue>(expression: string): Promise<TValue> {
    const answer = (await this.send('Runtime.evaluate', { expression, returnByValue: true })) as {
      readonly result: { readonly value: TValue };
    };
    return answer.result.value;
  }

  public async navigate(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
  }

  /** Polls until `probe` answers something `accept` takes, and returns it. */
  public async until<TValue>(
    probe: string,
    accept: (value: TValue | undefined) => boolean,
    timeoutMs = 10_000,
  ): Promise<TValue | undefined> {
    const deadline = Date.now() + timeoutMs;
    let last: TValue | undefined;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate<TValue>(probe);
      } catch {
        last = undefined;
      }
      if (accept(last)) return last;
      await pause(50);
    }
    return last;
  }

  public close(): void {
    this.socket.close();
  }

  private settle(raw: string): void {
    const message = JSON.parse(raw) as {
      readonly id?: number;
      readonly result?: unknown;
      readonly error?: { readonly message: string };
    };
    if (message.id === undefined) return;
    const waiting = this.pending.get(message.id);
    if (waiting === undefined) return;
    this.pending.delete(message.id);
    if (message.error === undefined) waiting.resolve(message.result);
    else waiting.reject(new Error(message.error.message));
  }
}

export { pause };
