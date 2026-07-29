import type { SessionContext } from '../sessions/sessions.service';

export function narrowToNamedJobs(
  question: string,
  session: SessionContext,
): string[] {
  const named = new Set<string>();

  for (const match of question.matchAll(/job\s*#?\s*(\d+)/gi)) {
    const documentId = session.jobIdsByLabel.get(Number(match[1]));

    if (documentId) {
      named.add(documentId);
    }
  }

  if (named.size === 0) {
    return session.documentIds;
  }

  return session.resumeId ? [session.resumeId, ...named] : [...named];
}
