// The server's REST API as typed calls. One place builds URLs, sends the token and turns error
// codes into the UI's language; components and hooks never call fetch themselves.
import type { CaseInfo, ConnectJob, Listing, Provider, RoleInfo, StartRequest, Suggestion } from './types';

const BASE = process.env.NEXT_PUBLIC_COUNCIL_API ?? '';
const caseUrl = (id: string, suffix = '') => `/api/cases/${encodeURIComponent(id)}${suffix}`;

/** The message of anything thrown. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface Followed { kind: string; markdown: string; citations?: { ref: string; verified: boolean | null }[]; ms: number }

/** `translate(code)` turns a server error code into a sentence, or returns undefined. */
export function createApi(token: string, translate: (code: string) => string | undefined) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(BASE + path, { ...init, headers: { 'X-Council-Token': token, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    const body: unknown = await r.json().catch(() => ({}));
    if (!r.ok) {
      const { code, error } = (body ?? {}) as { code?: string; error?: string };
      throw new Error((code && translate(code)) || error || `HTTP ${r.status}`);
    }
    return body as T;
  }
  const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    streamUrl: (id: string, speed: number) => `${BASE}${caseUrl(id, '/stream')}?token=${encodeURIComponent(token)}&speed=${speed}`,
    cases: () => call<CaseInfo[]>('/api/cases'),
    roles: () => call<{ roles: RoleInfo[]; models: string[] }>('/api/roles'),
    providers: () => call<Provider[]>('/api/providers'),
    suggest: (path: string, mode: string) => call<Suggestion[]>(`/api/suggest?path=${encodeURIComponent(path)}&mode=${mode}`),
    browse: (path: string) => call<Listing>(`/api/browse?path=${encodeURIComponent(path)}`),
    start: (body: StartRequest & { lang: string }) => post<{ id: string }>('/api/cases', body),
    stop: (id: string) => post<{ ok: boolean }>(caseUrl(id, '/stop')),
    note: (id: string, text: string) => post<{ seq: number }>(caseUrl(id, '/note'), { text }),
    analyse: (id: string, kind: string, lang: string) => post<Followed>(caseUrl(id, '/followup'), { kind, lang }),
    appeal: (id: string, lang: string) => post<{ id: string }>(caseUrl(id, '/followup'), { kind: 'appeal', lang }),
    connect: {
      status: (id: string) => call<ConnectJob>(`/api/providers/${encodeURIComponent(id)}/connect`),
      start: (id: string) => post<ConnectJob>(`/api/providers/${encodeURIComponent(id)}/connect`),
      forget: (id: string) => call<ConnectJob>(`/api/providers/${encodeURIComponent(id)}/connect`, { method: 'DELETE' }).then(() => undefined),
    },
    /** The case as a file; the token goes in a header, so the browser gets a blob to save. */
    async exportFile(id: string, format: 'md' | 'json', lang: string) {
      const r = await fetch(`${BASE}${caseUrl(id, '/export')}?format=${format}&lang=${lang}`, { headers: { 'X-Council-Token': token } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const name = r.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `case.${format}`;
      return { name, blob: await r.blob() };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
