/**
 * Analyzer entrypoint: run every rule, then turn penalties into a score.
 */
(function (root) {
  "use strict";

  const { analysisDocument, defaultPipeline } = root.SlopGuard;
  const {
    DENSITY_WORDS_BASIS,
    SCORE_MAX,
    bandForScore,
    computeWeightedSum,
    deduplicateAdvice,
    initialCounts,
    pyRoundTo,
    scoreFromDensity,
    serializeViolations,
  } = root.SlopGuard.scoring;

  const CONTEXT_WINDOW_CHARS = 60;
  const SHORT_TEXT_WORD_COUNT = 10;

  let cachedPipeline = null;

  function pipeline() {
    if (cachedPipeline === null) {
      cachedPipeline = defaultPipeline();
    }

    return cachedPipeline;
  }

  function analyzeText(text) {
    const rules = pipeline();
    const countKeys = [...new Set(rules.map((rule) => rule.countKey))];
    const doc = analysisDocument(text);

    if (doc.wordCount < SHORT_TEXT_WORD_COUNT) {
      return {
        score: SCORE_MAX,
        band: "clean",
        word_count: doc.wordCount,
        violations: [],
        counts: initialCounts(countKeys),
        total_penalty: 0,
        weighted_sum: 0.0,
        density: 0.0,
        advice: [],
      };
    }

    const counts = initialCounts(countKeys);
    const violations = [];
    const advice = [];

    for (const rule of rules) {
      const ruleResult = rule.forward(doc);

      violations.push(...ruleResult.violations);
      advice.push(...ruleResult.advice);

      for (const [key, delta] of Object.entries(ruleResult.countDeltas)) {
        if (delta) {
          counts[key] = (counts[key] || 0) + delta;
        }
      }
    }

    const totalPenalty = violations.reduce((sum, violation) => sum + violation.penalty, 0);
    const weightedSum = computeWeightedSum(violations, counts);
    const density =
      doc.wordCount > 0 ? weightedSum / (doc.wordCount / DENSITY_WORDS_BASIS) : 0.0;
    const score = scoreFromDensity(density);

    return {
      score,
      band: bandForScore(score),
      word_count: doc.wordCount,
      violations: serializeViolations(violations, doc.text, CONTEXT_WINDOW_CHARS),
      counts,
      total_penalty: totalPenalty,
      weighted_sum: pyRoundTo(weightedSum, 2),
      density: pyRoundTo(density, 2),
      advice: deduplicateAdvice(advice),
    };
  }

  root.SlopGuard = Object.assign(root.SlopGuard || {}, { analyzeText });
})(typeof globalThis !== "undefined" ? globalThis : this);
