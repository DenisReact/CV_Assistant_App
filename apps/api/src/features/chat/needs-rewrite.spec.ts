import { needsRewrite } from './needs-rewrite';

describe('needsRewrite', () => {
  it('never rewrites the first message of a session', () => {
    // There is no history to resolve against, so the call could only paraphrase.
    expect(needsRewrite('What about the second one?', 0)).toBe(false);
  });

  it.each([
    ['pronoun', 'How does it compare to my experience?'],
    ['demonstrative', 'Tell me more about that requirement'],
    ['ordinal reference', 'What about the second one?'],
    ['bare role noun', 'Am I a good fit for the role?'],
    ['plural pronoun', 'Do they want Kubernetes experience?'],
  ])('rewrites a follow-up carrying a %s', (_label, question) => {
    expect(needsRewrite(question, 4)).toBe(true);
  });

  it.each([
    ['already standalone', 'What skills am I missing for Job #2?'],
    ['names the job explicitly', 'Prepare me for an interview for Job #1'],
    ['self-contained and off-topic', 'What is the color of my shirt?'],
    ['no references at all', 'Summarise my PostgreSQL experience'],
  ])('skips the call when the question is %s', (_label, question) => {
    expect(needsRewrite(question, 4)).toBe(false);
  });

  it('does not treat a Job #N label as something to resolve', () => {
    // The label is already explicit; rewriting it risks the model dropping or
    // renumbering it, which would silently change retrieval scoping.
    expect(needsRewrite('How do I fit Job #3?', 6)).toBe(false);
  });

  it('matches on whole words, not substrings', () => {
    // "it" inside "criteria" must not trigger a rewrite.
    expect(needsRewrite('Which criteria am I missing?', 2)).toBe(false);
  });
});
