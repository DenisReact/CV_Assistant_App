import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { DocumentKind, MessageView, SessionFit } from './types';

export const queryKeys = {
  documents: ['documents'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['sessions', id] as const,
  messages: (id: string) => ['sessions', id, 'messages'] as const,
  fit: (id: string) => ['sessions', id, 'fit'] as const,
};

const INGEST_POLL_MS = 2000;

// ---------------------------------------------------------------- documents

export function useDocuments() {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: api.listDocuments,
    refetchInterval: (query) =>
      query.state.data?.some(
        (document) =>
          document.status === 'PENDING' || document.status === 'PROCESSING',
      )
        ? INGEST_POLL_MS
        : false,
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: DocumentKind }) =>
      api.uploadDocument(file, kind),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
}

export function useReprocessDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.reprocessDocument(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
}

// ----------------------------------------------------------------- sessions

export function useSessions() {
  return useQuery({ queryKey: queryKeys.sessions, queryFn: api.listSessions });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => api.getSession(id),
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createSession,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}

// --------------------------------------------------------------------- chat

export function useMessages(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.messages(sessionId),
    queryFn: () => api.getMessages(sessionId),
  });
}

export function useSendMessage(sessionId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.messages(sessionId);

  return useMutation({
    mutationFn: (content: string) => api.sendMessage(sessionId, content),

    onMutate: async (content) => {
      await queryClient.cancelQueries({ queryKey: key });

      const optimistic: MessageView = {
        id: `optimistic-${Date.now()}`,
        role: 'USER',
        content,
        citations: [],
        model: null,
        promptTokens: null,
        completionTokens: null,
        latencyMs: null,
        createdAt: new Date().toISOString(),
      };

      queryClient.setQueryData<MessageView[]>(key, (old = []) => [
        ...old,
        optimistic,
      ]);
    },

    onSuccess: (answer) => {
      queryClient.setQueryData<MessageView[]>(key, (old = []) => [
        ...old,
        answer,
      ]);
    },
  });
}

// ---------------------------------------------------------------------- fit

export function useFit(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.fit(sessionId),
    queryFn: () => api.getFit(sessionId),
  });
}

export function useRunFit(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (refresh: boolean) => api.runFit(sessionId, refresh),
    onSuccess: (fit: SessionFit) =>
      queryClient.setQueryData(queryKeys.fit(sessionId), fit),
  });
}
