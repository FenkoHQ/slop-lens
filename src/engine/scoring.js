/**
 * Scoring, counting, and violation span resolution.
 *
 * Score is an exponential decay on penalty density, so a handful of tells in a
 * long article barely moves the needle while the same tells packed into two
 * paragraphs tank it:
 *
 *   density = weighted_penalties / (words / 1000)
 *   score   = 100 * exp(-0.04 * density)
 */
(function (root) {
  "use strict";

  const { contextAround, escapeRegExp, findAll, pyRound, pyRoundTo } = root.SlopGuard.util;

  const COUNT_KEYS = [
    "slop_words", "slop_phrases", "structural", "tone", "weasel",
    "ai_disclosure", "placeholder", "rhythm", "em_dash", "contrast_pairs",
    "intrasentence_keyword_bold", "setup_resolution", "colon_density",
    "pithy_fragment", "bullet_density", "blockquote_density",
    "bold_bullet_list", "horizontal_rules", "phrase_reuse", "copula_chain",
    "extreme_sentence", "closing_aphorism", "paragraph_balance",
    "paragraph_cv",
  ];

  // Rhetorical tics that compound: three of them cost far more than 3x one.
  const CLAUDE_CATEGORIES = new Set(["contrast_pairs", "pithy_fragment", "setup_resolution"]);

  const CONCENTRATION_ALPHA = 2.5;
  const DECAY_LAMBDA = 0.04;
  const DENSITY_WORDS_BASIS = 1000.0;
  const SCORE_MIN = 0;
  const SCORE_MAX = 100;
  const BAND_CLEAN_MIN = 80;
  const BAND_LIGHT_MIN = 60;
  const BAND_MODERATE_MIN = 40;
  const BAND_HEAVY_MIN = 20;

  function initialCounts(countKeys) {
    const keys = countKeys || COUNT_KEYS;
    const counts = {};

    for (const key of keys) {
      counts[key] = 0;
    }

    return counts;
  }

  function literalSpanCandidates(text, match) {
    if (!match) {
      return [];
    }

    return findAll(new RegExp(escapeRegExp(match), "gi"), text).map((hit) => [hit.start, hit.end]);
  }

  function contextCore(context) {
    const start = context.startsWith("...") ? 3 : 0;
    const end = context.endsWith("...") ? context.length - 3 : context.length;

    return context.slice(start, end);
  }

  function contextSpanCandidates(normalizedText, context) {
    const core = contextCore(context);
    if (!core) {
      return [];
    }

    const spans = [];
    let start = 0;

    for (;;) {
      const index = normalizedText.indexOf(core, start);
      if (index < 0) {
        return spans;
      }
      spans.push([index, index + core.length]);
      start = index + 1;
    }
  }

  function selectUnusedSpan(candidates, usedSpans) {
    for (const span of candidates) {
      if (!usedSpans.has(`${span[0]},${span[1]}`)) {
        return span;
      }
    }

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Best-effort character span for a violation.
   *
   * Rules that already know their offsets say so. The rest are located by
   * re-finding the matched text, preferring an occurrence whose surrounding
   * context reproduces the recorded snippet.
   */
  function resolveViolationSpan(violation, text, normalizedText, contextWindowChars, usedSpans) {
    if (violation.start !== undefined && violation.start !== null && violation.end !== undefined) {
      return [violation.start, violation.end];
    }

    const literalCandidates = literalSpanCandidates(text, violation.match);
    const contextMatched = literalCandidates.filter(
      (span) => contextAround(text, span[0], span[1], contextWindowChars) === violation.context
    );

    const contextMatchedSpan = selectUnusedSpan(contextMatched, usedSpans);
    if (contextMatchedSpan !== null) {
      return contextMatchedSpan;
    }

    if (violation.context.toLowerCase().includes(violation.match.toLowerCase())) {
      const literalSpan = selectUnusedSpan(literalCandidates, usedSpans);
      if (literalSpan !== null) {
        return literalSpan;
      }
    }

    const contextSpan = selectUnusedSpan(
      contextSpanCandidates(normalizedText, violation.context),
      usedSpans
    );
    if (contextSpan !== null) {
      return contextSpan;
    }

    return [0, text.length];
  }

  function serializeViolations(violations, text, contextWindowChars) {
    const normalizedText = text.replace(/\n/g, " ");
    const usedSpans = new Set();
    const payloads = [];

    for (const violation of violations) {
      const [start, end] = resolveViolationSpan(
        violation,
        text,
        normalizedText,
        contextWindowChars,
        usedSpans
      );
      usedSpans.add(`${start},${end}`);

      payloads.push({
        type: "Violation",
        rule: violation.rule,
        match: violation.match,
        context: violation.context,
        penalty: violation.penalty,
        start,
        end,
      });
    }

    return payloads;
  }

  /** Penalty sum, amplified where one rhetorical tic repeats. */
  function computeWeightedSum(violations, counts) {
    let weightedSum = 0;

    for (const violation of violations) {
      const rule = violation.rule;
      const penalty = Math.abs(violation.penalty);
      const catCount = counts[rule] || counts[`${rule}s`] || 0;

      let countKey = null;
      if (CLAUDE_CATEGORIES.has(rule)) {
        countKey = rule;
      } else if (CLAUDE_CATEGORIES.has(`${rule}s`)) {
        countKey = `${rule}s`;
      }

      const amplified = countKey !== null && catCount > 1;
      weightedSum += amplified ? penalty * (1 + CONCENTRATION_ALPHA * (catCount - 1)) : penalty;
    }

    return weightedSum;
  }

  function bandForScore(score) {
    if (score >= BAND_CLEAN_MIN) {
      return "clean";
    }
    if (score >= BAND_LIGHT_MIN) {
      return "light";
    }
    if (score >= BAND_MODERATE_MIN) {
      return "moderate";
    }
    if (score >= BAND_HEAVY_MIN) {
      return "heavy";
    }

    return "saturated";
  }

  function deduplicateAdvice(advice) {
    const seen = new Set();
    const unique = [];

    for (const item of advice) {
      if (seen.has(item)) {
        continue;
      }
      seen.add(item);
      unique.push(item);
    }

    return unique;
  }

  function scoreFromDensity(density) {
    const raw = SCORE_MAX * Math.exp(-DECAY_LAMBDA * density);
    return Math.max(SCORE_MIN, Math.min(SCORE_MAX, pyRound(raw)));
  }

  root.SlopGuard = Object.assign(root.SlopGuard || {}, {
    scoring: {
      COUNT_KEYS,
      DENSITY_WORDS_BASIS,
      SCORE_MAX,
      bandForScore,
      computeWeightedSum,
      deduplicateAdvice,
      initialCounts,
      pyRoundTo,
      scoreFromDensity,
      serializeViolations,
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
