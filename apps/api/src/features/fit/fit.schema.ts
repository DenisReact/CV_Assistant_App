import { Type, type Schema } from '@google/genai';

export interface SkillMatch {
  skill: string;
  evidence: string;
}

export interface SkillGap {
  skill: string;
  severity: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
  note: string;
}

export interface FitDimension {
  name: string;
  score: number;
  rationale: string;
}

export interface FitBreakdown {
  overallScore: number;
  summary: string;
  dimensions: FitDimension[];
  matchedSkills: SkillMatch[];
  gaps: SkillGap[];
  interviewTalkingPoints: string[];
}

/**
 * A closed set, enforced as an enum in the schema below.
 *
 * Letting the model choose its own dimensions would make every analysis a
 * different shape — not comparable across jobs, and impossible to render as a
 * fixed dashboard. These four are what a candidate can actually act on.
 */
export const FIT_DIMENSIONS = [
  'Technical skills',
  'Experience level',
  'Domain relevance',
  'Responsibilities overlap',
] as const;

/**
 * The response contract, enforced by the provider rather than requested in
 * prose. Asking for JSON in a prompt yields JSON most of the time; a schema
 * yields it every time, with the required fields present.
 *
 * The `description` on each field is doing prompt work, not documentation work:
 * it is the only instruction the model gets about what belongs in that field,
 * which is why they read as directives.
 */
export const FIT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    'overallScore',
    'summary',
    'dimensions',
    'matchedSkills',
    'gaps',
    'interviewTalkingPoints',
  ],
  properties: {
    overallScore: {
      type: Type.INTEGER,
      description: '0-100 overall fit, consistent with the dimension scores',
    },
    summary: {
      type: Type.STRING,
      description: 'Two or three sentences on the overall fit',
    },
    dimensions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['name', 'score', 'rationale'],
        properties: {
          name: { type: Type.STRING, enum: [...FIT_DIMENSIONS] },
          score: { type: Type.INTEGER, description: '0-100' },
          rationale: {
            type: Type.STRING,
            description: 'One sentence citing what in the resume supports this',
          },
        },
      },
    },
    matchedSkills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['skill', 'evidence'],
        properties: {
          skill: { type: Type.STRING },
          evidence: {
            type: Type.STRING,
            description: 'The resume line or phrase that demonstrates it',
          },
        },
      },
    },
    gaps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['skill', 'severity', 'note'],
        properties: {
          skill: { type: Type.STRING },
          severity: {
            type: Type.STRING,
            enum: ['CRITICAL', 'IMPORTANT', 'NICE_TO_HAVE'],
          },
          note: {
            type: Type.STRING,
            description:
              'What the posting asks for and what the resume does not show',
          },
        },
      },
    },
    interviewTalkingPoints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Concrete points to raise, drawn from the overlap and gaps',
    },
  },
};

export const FIT_SYSTEM_PROMPT = `You score how well a candidate's resume fits a specific job description.

Rules:
- Judge only on the two documents supplied. Do not assume industry-standard experience that is not written down.
- A gap means the resume does not evidence something the posting asks for. Say it that way; you cannot know what the candidate has left off.
- Quote or closely paraphrase the resume when giving evidence for a matched skill, so the user can find it.
- Score honestly. An inflated score is worse than a low one, because the candidate acts on it.
- Weight gaps by what the posting itself emphasises: something listed as a hard requirement is CRITICAL, something under "nice to have" is not.
- Keep the overall score consistent with the dimension scores; it should read as a considered summary of them, not an average.`;

/**
 * The second half of the guarantee the schema starts.
 *
 * A schema fixes the shape but not the values: `INTEGER` admits 150 and -4 as
 * readily as 80, and a model asked for 0-100 does occasionally return a
 * percentage-of-something-else. Arrays declared without `required` can also
 * come back absent rather than empty.
 *
 * Scores are clamped rather than rejected, and missing arrays defaulted, so one
 * out-of-range number does not throw away an otherwise sound analysis. The
 * effect is that whatever reaches the database and the dashboard is renderable.
 */
export function validateFitBreakdown(value: unknown): FitBreakdown {
  const raw = value as FitBreakdown;

  return {
    ...raw,
    overallScore: clampScore(raw.overallScore),
    dimensions: (raw.dimensions ?? []).map((dimension) => ({
      ...dimension,
      score: clampScore(dimension.score),
    })),
    matchedSkills: raw.matchedSkills ?? [],
    gaps: raw.gaps ?? [],
    interviewTalkingPoints: raw.interviewTalkingPoints ?? [],
  };
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
