import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentClassifierService } from './document-classifier.service';
import { DocumentKind } from '../../generated/prisma/enums';

/**
 * Fixtures are the real sample documents shipped in the repo, so the thresholds
 * are calibrated against the same text a reviewer will upload rather than
 * against strings written to make the test pass.
 */
const sample = (name: string): string =>
  readFileSync(join(__dirname, '../../../../../samples', name), 'utf8');

describe('DocumentClassifierService', () => {
  const service = new DocumentClassifierService();

  const RESUME = sample('resume-ada-okonkwo.txt');
  const JOB = sample('jd-1-senior-platform-engineer.txt');

  const accepts = (text: string, kind: DocumentKind) =>
    service.classify(text, kind).problem;

  it('accepts a real resume declared as a resume', () => {
    expect(accepts(RESUME, DocumentKind.RESUME)).toBeNull();
  });

  it.each([
    'jd-1-senior-platform-engineer.txt',
    'jd-2-fullstack-product-engineer.txt',
    'jd-3-site-reliability-engineer.txt',
    'jd-4-ml-engineer-computer-vision.txt',
  ])('accepts %s declared as a job description', (name) => {
    expect(accepts(sample(name), DocumentKind.JOB_DESCRIPTION)).toBeNull();
  });

  it('catches a job description uploaded as a resume', () => {
    expect(accepts(JOB, DocumentKind.RESUME)).toMatch(/looks like a job/i);
  });

  it('catches a resume uploaded as a job description', () => {
    expect(accepts(RESUME, DocumentKind.JOB_DESCRIPTION)).toMatch(
      /looks like a resume/i,
    );
  });

  it('rejects letterhead: contact details without any career structure', () => {
    // Regression. An earlier version accepted a real bank statement, because
    // the bank's own support email and phone number scored as resume evidence
    // and that alone cleared the threshold. Contact details establish that a
    // document has a sender, not that it describes someone's career — so they
    // no longer count toward the accept/reject gate.
    const statement = `ACME BANK PLC
Registered address: 1 Example Street, London
Contact us: +44 20 7946 0000
e-mail: support@acmebank.example

Statement of account
Account holder: J. Doe
Period: 01.06.2026 - 30.06.2026

Opening balance: 5,108.61
Card purchase SUPERMARKET -42.10
Direct debit UTILITIES -88.00
Closing balance: 4,534.07`;

    const scores = service.score(statement);

    // Contact details still register on the raw score…
    expect(scores.resume).toBeGreaterThan(0);
    // …but contribute nothing structural, which is what the gate reads.
    expect(scores.resumeStructural).toBe(0);
    expect(scores.jobStructural).toBe(0);
    expect(accepts(statement, DocumentKind.RESUME)).toMatch(
      /does not read like/i,
    );
  });

  it.each([
    [
      'a short statement',
      'Account Statement. Opening balance 1,204.55 EUR. 03/04 CARD PURCHASE SUPERMARKET 42.10. Closing balance 1,074.45 EUR.',
    ],
    [
      'a recipe',
      'Classic Tomato Soup. Ingredients: 1kg tomatoes, 2 onions, garlic, basil. Roast the tomatoes, blend, season and serve.',
    ],
    [
      'placeholder text',
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    ],
  ])('rejects %s as neither kind', (_label, text) => {
    expect(accepts(text, DocumentKind.RESUME)).toMatch(/does not read like/i);
  });

  it('separates the two kinds by a wide margin, not a hair', () => {
    const resumeScores = service.score(RESUME);
    const jobScores = service.score(JOB);

    // Guards the thresholds: if a future signal edit collapses this gap, the
    // classifier is one unusual document away from false rejections.
    expect(resumeScores.resume).toBeGreaterThan(resumeScores.job * 3);
    expect(jobScores.job).toBeGreaterThan(jobScores.resume * 3);
  });

  it('lets a resume through even when it borrows posting vocabulary', () => {
    // Plenty of real CVs list "Responsibilities" under a role and mention
    // "years of experience" — that must not read as a job posting.
    const text = `Jane Doe
jane.doe@example.com

EXPERIENCE
Senior Engineer, Acme (2019 - present)
Responsibilities: owned the billing service. Ten years of experience in total.

EDUCATION
BSc Computer Science, 2014`;

    expect(accepts(text, DocumentKind.RESUME)).toBeNull();
  });
});
