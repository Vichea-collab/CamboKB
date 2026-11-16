const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Init = { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };

/** JSON request to the api with the session cookie. Non-2xx throws ApiError. */
export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body !== undefined && !isForm) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers,
      body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the store right now. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  }
  return data as T;
}

/** URL for links the browser opens directly (PDFs, CSV downloads). */
export const apiUrl = (path: string) => `${BASE}${path}`;

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (!code || e.code === code);
