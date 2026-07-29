/**
 * Words that make a question depend on what came before it. Pronouns and
 * demonstratives ("it", "that"), ordinals used as references ("the second"),
 * and bare role nouns ("the role") that only mean something once a previous
 * turn has named which one.
 *
 * Deliberately does not include `Job #N` — that label is already explicit, and
 * a question carrying one stands on its own.
 */
const REFERENTIAL =
  /\b(it|its|that|this|those|these|they|them|their|he|him|his|she|her|the (first|second|third|fourth|last|other|same|previous|above)|the (role|position|job|one|company)|there|instead|too|also)\b/i;

/**
 * Whether a follow-up actually needs the rewrite call.
 *
 * The rewrite exists to resolve references against history, and it costs a
 * generation every time it runs. On a free tier of 20 generations a day, a chat
 * turn that spends two — one to rewrite, one to answer — halves how much the
 * app can be used. Measured example: rewriting "What is color of my shirt ?"
 * into "What is the color of my shirt?" bought a corrected article and nothing
 * retrieval could use.
 *
 * A question with no referential term is already standalone, so embedding it
 * directly is not a degradation. Skipping is safe in the other direction too:
 * if this misses a case, retrieval falls back to searching with the raw
 * question — exactly what already happens when the rewrite call fails.
 */
export function needsRewrite(
  question: string,
  priorTurnCount: number,
): boolean {
  if (priorTurnCount === 0) {
    return false;
  }

  return REFERENTIAL.test(question);
}
