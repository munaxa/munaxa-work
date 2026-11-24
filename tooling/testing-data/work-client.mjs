/**
 * The small Work API client the synthetic loader uses: bearer token, optional tenant header, JSON,
 * and the three list shapes the API answers with (a bare array, `{ items, totalPages }` paging and
 * `{ items }` limit/offset paging). Node built-ins only.
 */

export const TENANT_HEADER = 'x-munaxa-tenant';
const PAGE_SIZE = 200;

export class ApiError extends Error {
  constructor(method, path, status, detail) {
    super(`${method} ${path} answered ${status}${detail ? `: ${detail}` : ''}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Removes anything token-shaped from a message before it is printed. */
export const sanitize = (text) =>
  String(text)
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/\b(Bearer)\s+\S+/gi, '$1 [redacted]');

const detailOf = (text) => {
  try {
    const body = JSON.parse(text);
    const message = body.detail ?? body.message ?? body.title ?? '';
    return sanitize(Array.isArray(message) ? message.join('; ') : String(message)).slice(0, 300);
  } catch {
    return '';
  }
};

export const itemsOf = (body) => {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  return [];
};

export const createWorkClient = ({ baseUrl, token, tenantId, fetch, timeoutMs = 30_000 }) => {
  const request = async (method, path, body) => {
    const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
    if (tenantId) headers[TENANT_HEADER] = tenantId;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new ApiError(method, path, response.status, detailOf(text));
    return text === '' ? undefined : JSON.parse(text);
  };

  /** Every item of a list, following whichever paging the route uses. */
  const list = async (path, query = {}) => {
    const all = [];
    for (let page = 1; ; page += 1) {
      const parameters = new URLSearchParams({
        ...query,
        page: String(page),
        size: String(PAGE_SIZE),
      });
      const body = await request('GET', `${path}?${parameters}`);
      const items = itemsOf(body);
      all.push(...items);
      const more =
        body && typeof body.totalPages === 'number'
          ? page < body.totalPages
          : !Array.isArray(body) && items.length === PAGE_SIZE;
      if (!more) return all;
    }
  };

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
    put: (path, body) => request('PUT', path, body ?? {}),
    list,
  };
};
