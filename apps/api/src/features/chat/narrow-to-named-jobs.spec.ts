import { narrowToNamedJobs } from './narrow-to-named-jobs';
import type { SessionContext } from '../sessions/sessions.service';

describe('narrowToNamedJobs', () => {
  const session: SessionContext = {
    resumeId: 'resume',
    documentIds: ['resume', 'job-a', 'job-b', 'job-c'],
    labels: new Map([
      ['resume', 'Resume'],
      ['job-a', 'Job #1'],
      ['job-b', 'Job #2'],
      ['job-c', 'Job #3'],
    ]),
    jobIdsByLabel: new Map([
      [1, 'job-a'],
      [2, 'job-b'],
      [3, 'job-c'],
    ]),
  };

  it('scopes to the named job plus the resume', () => {
    expect(narrowToNamedJobs('How do I align with Job #2?', session)).toEqual([
      'resume',
      'job-b',
    ]);
  });

  it.each(['job 2', 'JOB #2', 'job#2', 'Job  # 2'])(
    'tolerates the spellings users actually type: "%s"',
    (spelling) => {
      expect(narrowToNamedJobs(spelling, session)).toEqual(['resume', 'job-b']);
    },
  );

  it('keeps every named job on a comparative question', () => {
    expect(
      narrowToNamedJobs('Compare Job #1 and Job #3 for me', session),
    ).toEqual(['resume', 'job-a', 'job-c']);
  });

  it('leaves an unspecific question unscoped', () => {
    expect(narrowToNamedJobs('What are my biggest gaps?', session)).toEqual(
      session.documentIds,
    );
  });

  it('ignores a label that does not exist rather than narrowing to nothing', () => {
    // "Job #9" matches the pattern but names no document; treating it as a
    // scope would silently search an empty set and answer "no evidence".
    expect(narrowToNamedJobs('What about Job #9?', session)).toEqual(
      session.documentIds,
    );
  });

  it('works without a resume attached', () => {
    const noResume: SessionContext = {
      ...session,
      resumeId: null,
      documentIds: ['job-a', 'job-b', 'job-c'],
    };

    expect(narrowToNamedJobs('Job #1?', noResume)).toEqual(['job-a']);
  });
});
