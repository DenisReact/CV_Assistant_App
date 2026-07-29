import type {
  DocumentKind,
  DocumentView,
  MessageView,
  SessionFit,
  SessionView,
  User,
} from './types';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const EMAIL_STORAGE_KEY = 'cia.email';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getStoredEmail(): string | null {
  return localStorage.getItem(EMAIL_STORAGE_KEY);
}

export function setStoredEmail(email: string | null): void {
  if (email) {
    localStorage.setItem(EMAIL_STORAGE_KEY, email);
  } else {
    localStorage.removeItem(EMAIL_STORAGE_KEY);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  body?: unknown,
): Promise<T> {
  const email = getStoredEmail();
  const headers = new Headers(init.headers);

  if (email) {
    headers.set('x-user-email', email);
  }

  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    body:
      body instanceof FormData
        ? body
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();

  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    const message = parsed.message;

    if (Array.isArray(message)) {
      return message.join(', ');
    }

    return message ?? text;
  } catch {
    return text || `Request failed with ${response.status}`;
  }
}

export const api = {
  login: (email: string) =>
    request<User>('/auth/login', { method: 'POST' }, { email }),

  me: () => request<User>('/auth/me'),

  listDocuments: () => request<DocumentView[]>('/documents'),

  uploadDocument: (file: File, kind: DocumentKind, title?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);

    if (title) {
      form.append('title', title);
    }

    return request<DocumentView>('/documents', { method: 'POST' }, form);
  },

  deleteDocument: (id: string) =>
    request<void>(`/documents/${id}`, { method: 'DELETE' }),

  reprocessDocument: (id: string) =>
    request<DocumentView>(`/documents/${id}/reprocess`, { method: 'POST' }),

  listSessions: () => request<SessionView[]>('/sessions'),

  getSession: (id: string) => request<SessionView>(`/sessions/${id}`),

  createSession: (input: {
    resumeId?: string;
    jobIds?: string[];
    title?: string;
  }) => request<SessionView>('/sessions', { method: 'POST' }, input),

  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, { method: 'DELETE' }),

  getMessages: (sessionId: string) =>
    request<MessageView[]>(`/sessions/${sessionId}/messages`),

  sendMessage: (sessionId: string, content: string) =>
    request<MessageView>(
      `/sessions/${sessionId}/messages`,
      { method: 'POST' },
      { content },
    ),

  getFit: (sessionId: string) =>
    request<SessionFit>(`/sessions/${sessionId}/fit`),

  runFit: (sessionId: string, refresh = false) =>
    request<SessionFit>(
      `/sessions/${sessionId}/fit`,
      { method: 'POST' },
      { refresh },
    ),
};
