import type { SessionContext } from '../sessions/sessions.service';

/**
 * Restricts retrieval to the jobs a question actually names.
 *
 * Job postings in one session are near-identical in embedding space — same
 * industry, same vocabulary, often the same seniority — so "how do I fit
 * Job #1?" happily retrieves the requirements of Job #3 and answers about the
 * wrong role. Vector similarity cannot tell them apart; the label the user
 * typed can.
 *
 * A question naming no job stays session-wide, because comparing across jobs is
 * a legitimate thing to ask. The resume is always kept in scope: every question
 * here is implicitly about the candidate, so dropping it would leave the model
 * with a job description and nothing to compare it to.
 *
 * Pure and separately tested — this is a correctness-critical filter, and
 * running it against a real session would mean standing up a database to
 * confirm a regex.
 */
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
