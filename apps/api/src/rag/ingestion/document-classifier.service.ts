import { Injectable } from '@nestjs/common';
import { DocumentKind } from '../../generated/prisma/enums';

/**
 * Weighted signal totals for each kind. The `*Structural` variants count only
 * the signals that require document structure — a career history, a
 * requirements list — excluding incidental ones like an email address that any
 * document might carry.
 *
 * Both are kept because they answer different questions: the totals say which
 * kind this looks more like, the structural totals say whether it looks like
 * either at all.
 */
export interface ClassificationScores {
  resume: number;
  job: number;
  resumeStructural: number;
  jobStructural: number;
}

export interface ClassificationResult extends ClassificationScores {
  /** null when the text is a plausible instance of the declared kind. */
  problem: string | null;
}

interface Signal {
  pattern: RegExp;
  weight: number;
  structural?: boolean;
}

/**
 * Markers of a document *about a person*: a contact block, dated employment
 * history, qualifications. Deliberately excludes bare "experience" and "skills",
 * which job postings use just as often.
 */
const RESUME_SIGNALS: Signal[] = [
  { pattern: /[\w.+-]+@[\w-]+\.[\w.]{2,}/, weight: 2, structural: false },
  { pattern: /\+\d[\d\s()-]{7,}/, weight: 1, structural: false },

  // Career history: the things only a CV actually has.
  {
    pattern: /\b(19|20)\d{2}\s*[-–—]+\s*((19|20)\d{2}|present|current)\b/i,
    weight: 4,
    structural: true,
  },
  { pattern: /^\s*education\b/im, weight: 4, structural: true },
  {
    pattern: /^\s*(work\s+|professional\s+)?experience\b/im,
    weight: 4,
    structural: true,
  },
  {
    pattern: /\b(employment|work)\s+history\b/i,
    weight: 4,
    structural: true,
  },
  {
    pattern: /\b(bsc|msc|b\.?a\.?|m\.?a\.?|ph\.?d|bachelor|master)\b/i,
    weight: 3,
    structural: true,
  },
  { pattern: /\bcertifications?\b/i, weight: 2, structural: true },
  {
    pattern: /^\s*(professional\s+)?summary\b/im,
    weight: 2,
    structural: true,
  },
  { pattern: /\breferences\b/i, weight: 1, structural: true },
];

/**
 * Markers of a document *addressed to a candidate*: second person, an offer, a
 * requirements list. These are what a posting has and a CV does not.
 */
const JOB_SIGNALS: Signal[] = [
  { pattern: /\bwe(?:'re| are)\s+(looking|hiring|seeking)\b/i, weight: 5 },
  {
    pattern: /\babout\s+(us|the\s+role|the\s+team|the\s+company)\b/i,
    weight: 4,
  },
  { pattern: /\b(responsibilities|requirements|qualifications)\b/i, weight: 3 },
  { pattern: /\bwhat\s+we\s+offer\b|\bwe\s+offer\b/i, weight: 4 },
  { pattern: /\byou(?:'ll| will)\b/i, weight: 4 },
  {
    pattern:
      /\bnice\s+to\s+have\b|\bmust\s+have\b|\b(strongly\s+)?preferred\b/i,
    weight: 3,
  },
  { pattern: /\bjoin\s+(our|the)\s+team\b/i, weight: 4 },
  { pattern: /\bthe\s+(role|position)\b/i, weight: 2 },
  { pattern: /\b(salary|compensation|equity|vacation\s+days)\b/i, weight: 2 },
  { pattern: /\byears\s+(of\s+)?[\w\s]{0,20}experience\b/i, weight: 2 },
  { pattern: /\bapply\b|\bapplication\b/i, weight: 1 },
];

/**
 * Below this combined score the text reads like neither — a bank statement, an
 * invoice, a photo caption. Set low: the cost of a false rejection (a user
 * blocked from their own CV) is much higher than the cost of letting an odd but
 * genuine document through.
 */
const MIN_EVIDENCE = 4;

/** The wrong kind must outscore the declared one by this much to be called out. */
const MISMATCH_RATIO = 2;

/** …and reach this absolute score, so two weak signals cannot trigger it. */
const MISMATCH_FLOOR = 10;

/**
 * A cheap structural check that the uploaded text is the kind of document the
 * user said it is.
 *
 * Heuristics rather than an LLM call, for three reasons: an upload should not
 * consume generation quota (the free tier allows 20 calls a day), the result is
 * deterministic and therefore testable, and a misclassification here is
 * recoverable while a wasted rate limit is not. It runs inside the upload
 * request so a mistake is reported immediately, before anything is embedded.
 */
@Injectable()
export class DocumentClassifierService {
  /**
   * Scores are returned alongside the verdict so callers can log them on a
   * rejection — when a user disputes one, the weights that produced it are the
   * only way to tune the thresholds against a real document.
   */
  classify(text: string, declared: DocumentKind): ClassificationResult {
    const scores = this.score(text);

    return { ...scores, problem: this.diagnose(scores, declared) };
  }

  /** Public for tests: the thresholds are only meaningful against real scores. */
  score(text: string): ClassificationScores {
    return {
      resume: this.sum(text, RESUME_SIGNALS, false),
      job: this.sum(text, JOB_SIGNALS, false),
      resumeStructural: this.sum(text, RESUME_SIGNALS, true),
      jobStructural: this.sum(text, JOB_SIGNALS, true),
    };
  }

  private diagnose(
    scores: ClassificationScores,
    declared: DocumentKind,
  ): string | null {
    const { resume, job, resumeStructural, jobStructural } = scores;

    // Gated on structural evidence, not the totals. A bank statement carries
    // the bank's own email and phone number, which is enough contact detail to
    // pass a naive threshold while containing nothing resembling a career
    // history — that exact file is a regression test.
    if (resumeStructural + jobStructural < MIN_EVIDENCE) {
      return 'This does not read like a resume or a job posting. Check you uploaded the right file.';
    }

    const isResume = declared === DocumentKind.RESUME;
    const declaredScore = isResume ? resume : job;
    const otherScore = isResume ? job : resume;

    if (
      otherScore >= MISMATCH_FLOOR &&
      otherScore >= declaredScore * MISMATCH_RATIO
    ) {
      return isResume
        ? 'This looks like a job description rather than a resume. Upload it under "Job description" instead.'
        : 'This looks like a resume rather than a job description. Upload it under "Resume" instead.';
    }

    return null;
  }

  /**
   * Distinct signals, not occurrences: a posting that says "you will" six times
   * should not outrank one that shows six different markers.
   *
   * Signals are structural unless explicitly marked otherwise.
   */
  private sum(
    text: string,
    signals: Signal[],
    structuralOnly: boolean,
  ): number {
    return signals.reduce((total, signal) => {
      if (structuralOnly && signal.structural === false) {
        return total;
      }

      return signal.pattern.test(text) ? total + signal.weight : total;
    }, 0);
  }
}
