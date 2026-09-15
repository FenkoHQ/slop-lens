/**
 * The 24 slop-guard rules, ported from slop-guard 0.5.0 (MIT, Eric W. Tramel).
 *
 * Each rule exposes `forward(document)` and returns
 * `{violations, advice, countDeltas}`. Rule order and every threshold match
 * the packaged `rules/assets/default.jsonl` pipeline.
 */
(function (root) {
  "use strict";

  const {
    contextAround,
    findAll,
    fmtFixed,
    fmtPercent0,
    isLetter,
    isSpace,
    isUpper,
    splitWs,
  } = root.SlopGuard.util;
  const { findRepeatedNgrams, hasRepeatedNgramPrefix } = root.SlopGuard.ngrams;

  const WORD_CHAR = "[\\p{L}\\p{N}_]";

  function result(violations, advice, countKey, count) {
    return {
      violations: violations || [],
      advice: advice || [],
      countDeltas: count ? { [countKey]: count } : {},
    };
  }

  const EMPTY = () => ({ violations: [], advice: [], countDeltas: {} });

  /** Scan `lowerText` for each literal phrase, in phrase order. */
  function findLiteralPhrases(lowerText, phrases) {
    const hits = [];

    for (const phrase of phrases) {
      let start = 0;
      for (;;) {
        const hitStart = lowerText.indexOf(phrase, start);
        if (hitStart < 0) {
          break;
        }
        hits.push({ phrase, start: hitStart, end: hitStart + phrase.length });
        start = hitStart + phrase.length;
      }
    }

    return hits;
  }

  // ---------------------------------------------------------------------------
  // 1. slop_word
  // ---------------------------------------------------------------------------

  const SLOP_ADJECTIVES = [
    "crucial", "groundbreaking", "pivotal", "paramount", "seamless",
    "holistic", "multifaceted", "meticulous", "profound", "comprehensive",
    "invaluable", "notable", "noteworthy", "game-changing", "revolutionary",
    "pioneering", "visionary", "formidable", "quintessential", "unparalleled",
    "stunning", "breathtaking", "captivating", "nestled", "robust",
    "innovative", "cutting-edge", "impactful", "foundational", "actionable",
    "collaborative", "societal", "impeccable", "stylistic",
  ];

  const SLOP_VERBS = [
    "delve", "delves", "delved", "delving", "embark", "embrace", "elevate",
    "foster", "harness", "unleash", "unlock", "orchestrate", "streamline",
    "transcend", "navigate", "underscore", "showcase", "leverage", "ensuring",
    "highlighting", "emphasizing", "reflecting", "reshape",
  ];

  const SLOP_NOUNS = [
    "landscape", "tapestry", "journey", "paradigm", "testament", "trajectory",
    "nexus", "symphony", "spectrum", "odyssey", "pinnacle", "realm",
    "intricacies", "ecosystem", "authenticity", "narrative", "perseverance",
  ];

  // Routine connectives ("however", "furthermore") are deliberately absent:
  // they are standard prose, not AI tells.
  const SLOP_HEDGE = [
    "significantly", "interestingly", "remarkably", "surprisingly",
    "fascinatingly", "subtly",
  ];

  const ALL_SLOP_WORDS = [...SLOP_ADJECTIVES, ...SLOP_VERBS, ...SLOP_NOUNS, ...SLOP_HEDGE];
  const PLAIN_SLOP_WORDS = new Set(ALL_SLOP_WORDS.filter((word) => !word.includes("-")));
  const HYPHENATED_SLOP_WORDS = ALL_SLOP_WORDS.filter((word) => word.includes("-"));
  const SLOP_ADJECTIVE_SET = new Set(SLOP_ADJECTIVES);
  const SLOP_VERB_SET = new Set(SLOP_VERBS);
  const SLOP_HEDGE_SET = new Set(SLOP_HEDGE);
  const SLOP_SYSTEM_NOUNS = new Set([
    "ecosystem", "landscape", "nexus", "realm", "spectrum", "symphony", "tapestry",
  ]);
  const SLOP_TIMELINE_NOUNS = new Set(["journey", "narrative", "odyssey", "trajectory"]);

  const SLOP_WORD_RE = new RegExp(`\\b(${ALL_SLOP_WORDS.join("|")})\\b`, "gi");
  const TITLE_CASE_NAME_TOKEN_RE = /^(?:[A-Z][a-z]+(?:['-][A-Z][a-z]+)*|[A-Z]\.)$/;

  function occurrenceSuffix(count) {
    return count <= 1 ? "" : ` (${count} occurrences)`;
  }

  function slopWordAdvice(word, count) {
    const suffix = occurrenceSuffix(count);

    if (SLOP_HEDGE_SET.has(word)) {
      return `Cut '${word}'${suffix}. Start the sentence directly or show the connection without announcing it.`;
    }
    if (SLOP_VERB_SET.has(word)) {
      return `Replace '${word}'${suffix} with the specific action, result, or evidence.`;
    }
    if (SLOP_SYSTEM_NOUNS.has(word)) {
      return `Replace '${word}'${suffix} with the concrete system, group, or thing you mean.`;
    }
    if (SLOP_TIMELINE_NOUNS.has(word)) {
      return `Replace '${word}'${suffix} with the actual period, step, or change you observed.`;
    }
    if (SLOP_ADJECTIVE_SET.has(word)) {
      return `Cut '${word}'${suffix} unless you can name the concrete property, metric, or consequence.`;
    }

    return `Replace '${word}'${suffix} with the concrete object, event, or claim.`;
  }

  function previousWordSpan(text, start) {
    let index = start - 1;
    while (index >= 0 && isSpace(text[index])) {
      index -= 1;
    }
    if (index < 0 || !isLetter(text[index])) {
      return null;
    }

    const end = index + 1;
    while (index >= 0 && (isLetter(text[index]) || "'.-".includes(text[index]))) {
      index -= 1;
    }

    return index + 1 < end ? [index + 1, end] : null;
  }

  function nextWordSpan(text, end) {
    let index = end;
    while (index < text.length && isSpace(text[index])) {
      index += 1;
    }
    if (index >= text.length || !isLetter(text[index])) {
      return null;
    }

    const start = index;
    while (index < text.length && (isLetter(text[index]) || "'.-".includes(text[index]))) {
      index += 1;
    }

    return start < index ? [start, index] : null;
  }

  /** "Nestled" in "Kate Nestled Brown" is a name, not a slop word. */
  function isProbableProperNoun(text, hit) {
    if (!isUpper(hit.text[0] || "")) {
      return false;
    }

    const previous = previousWordSpan(text, hit.start);
    if (previous !== null && TITLE_CASE_NAME_TOKEN_RE.test(text.slice(previous[0], previous[1]))) {
      return true;
    }

    const next = nextWordSpan(text, hit.end);
    if (next === null) {
      return false;
    }

    return TITLE_CASE_NAME_TOKEN_RE.test(text.slice(next[0], next[1]));
  }

  function slopWordRule(config) {
    return {
      name: "slop_word",
      countKey: "slop_words",
      forward(doc) {
        const tokens = doc.maskedWordTokenSetLower;
        const hasPlain = [...PLAIN_SLOP_WORDS].some((word) => tokens.has(word));
        const hasHyphenated = HYPHENATED_SLOP_WORDS.some((word) =>
          doc.lowerMaskedText.includes(word)
        );

        if (!hasPlain && !hasHyphenated) {
          return EMPTY();
        }

        const violations = [];
        const wordCounts = new Map();
        const adviceOrder = [];

        for (const hit of findAll(SLOP_WORD_RE, doc.maskedText)) {
          if (isProbableProperNoun(doc.text, hit)) {
            continue;
          }

          const word = hit.text.toLowerCase();
          violations.push({
            rule: this.name,
            match: word,
            context: contextAround(doc.text, hit.start, hit.end, config.contextWindowChars),
            penalty: config.penalty,
            start: hit.start,
            end: hit.end,
          });

          if (!wordCounts.has(word)) {
            wordCounts.set(word, 0);
            adviceOrder.push(word);
          }
          wordCounts.set(word, wordCounts.get(word) + 1);
        }

        const advice = adviceOrder.map((word) => slopWordAdvice(word, wordCounts.get(word)));
        return result(violations, advice, this.countKey, violations.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 2. slop_phrase
  // ---------------------------------------------------------------------------

  const SLOP_PHRASES = [
    "it's worth noting", "it's important to note", "this is where things get interesting",
    "here's the thing", "at the end of the day", "in today's fast-paced",
    "as technology continues to", "something shifted", "everything changed",
    "the answer? it's simpler than you think", "what makes this work is",
    "this is exactly", "let's break this down", "let's dive in",
    "in this post, we'll explore", "in this article, we'll", "let me know if",
    "would you like me to", "i hope this helps", "as mentioned earlier",
    "as i mentioned", "without further ado", "on the other hand", "in addition",
    "in summary", "in conclusion", "you might be wondering",
    "the obvious question is", "no discussion would be complete", "great question",
    "that's a great", "if you want, i can", "i can adapt this", "i can make this",
    "here are some options", "here are a few options", "would you prefer",
    "shall i", "if you'd like, i can", "i can also", "in other words",
    "put differently", "that is to say", "to put it simply", "to put it another way",
    "what this means is", "the takeaway is", "the bottom line is",
    "the key takeaway", "the key insight", "many moving parts",
    "on the same page", "long-term impact", "the results will follow",
    "small fixes add up", "what truly makes this work is",
    "the answer is straightforward", "the answer is simpler than it seems",
    "without overwhelming", "untethered from", "example scenario",
    "lens through which", "remains essential", "lived reality",
    "highlight the need for", "collaborate closely", "address this gap",
    "communicate openly", "can feel overwhelming", "work together to build",
    "effective communication", "great starting point", "deliberate choice",
    "providing clear", "can vary based on", "specific needs",
    "to adapt to different", "adapt to different", "dynamic environment",
    "build confidence", "we inhabit", "informed decision", "learned behavior",
    "strategic direction", "in contemporary", "these findings suggest",
    "these results suggest", "these metrics suggest", "these observations suggest",
    "these measurements suggest", "the practical implication is",
    "the practical consequence is", "it remains unclear",
    "does not necessarily imply", "note that this", "note that the",
    "making them available", "making it available",
  ];

  const NOT_JUST_BUT_RE = /not (just|only) .{1,40}, but (also )?/gi;

  const INTERACTIVE_PHRASES = new Set([
    "as i mentioned", "as mentioned earlier", "feel free to",
    "here are a few options", "here are some options", "i can adapt this",
    "i can also", "i can make this", "i hope this helps", "if you'd like, i can",
    "if you want, i can", "let me know if", "shall i", "would you like me to",
    "would you prefer",
  ]);

  const ANNOUNCEMENT_PHRASES = new Set([
    "everything changed", "something shifted",
    "the answer? it's simpler than you think", "this is where things get interesting",
  ]);

  const TRANSITION_PHRASES = new Set([
    "in addition", "in conclusion", "in other words", "in summary",
    "on the other hand", "put differently", "that is to say",
    "to put it another way", "to put it simply",
  ]);

  function slopPhraseAdvice(phrase) {
    if (INTERACTIVE_PHRASES.has(phrase)) {
      return `Cut '${phrase}'. Replace the invitation with the actual point.`;
    }
    if (ANNOUNCEMENT_PHRASES.has(phrase)) {
      return `Cut '${phrase}'. Replace the announcement with the actual point.`;
    }
    if (TRANSITION_PHRASES.has(phrase)) {
      return `Cut '${phrase}'. Start the sentence directly or show the relationship with the content itself.`;
    }

    return `Cut '${phrase}'. Replace the setup with the actual point.`;
  }

  function slopPhraseRule(config) {
    return {
      name: "slop_phrase",
      countKey: "slop_phrases",
      forward(doc) {
        const violations = [];
        const advice = [];

        for (const hit of findLiteralPhrases(doc.lowerText, SLOP_PHRASES)) {
          violations.push({
            rule: this.name,
            match: hit.phrase,
            context: contextAround(doc.text, hit.start, hit.end, config.contextWindowChars),
            penalty: config.penalty,
          });
          advice.push(slopPhraseAdvice(hit.phrase));
        }

        const tokens = doc.wordTokenSetLower;
        if (tokens.has("not") && tokens.has("but") && doc.text.includes(",")) {
          for (const hit of findAll(NOT_JUST_BUT_RE, doc.text)) {
            const phrase = hit.text.trim().toLowerCase();
            violations.push({
              rule: this.name,
              match: phrase,
              context: contextAround(doc.text, hit.start, hit.end, config.contextWindowChars),
              penalty: config.penalty,
            });
            advice.push(`Cut '${phrase}'. Replace the setup with the actual point.`);
          }
        }

        return result(violations, advice, this.countKey, violations.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 3. structural
  // ---------------------------------------------------------------------------

  const BOLD_HEADER_RE = /\*\*[^*]+[.:]\*\*\s+\S/g;
  const TRIADIC_RE = new RegExp(`${WORD_CHAR}+, ${WORD_CHAR}+, and ${WORD_CHAR}+`, "giu");

  function structuralPatternRule(config) {
    return {
      name: "structural",
      countKey: "structural",
      forward(doc) {
        const violations = [];
        const advice = [];
        let count = 0;

        const boldMatches = findAll(BOLD_HEADER_RE, doc.text);
        if (boldMatches.length >= config.boldHeaderMin) {
          violations.push({
            rule: this.name,
            match: "bold_header_explanation",
            context: `Found ${boldMatches.length} instances of **Bold.** pattern`,
            penalty: config.boldHeaderPenalty,
          });
          advice.push(
            `Vary paragraph structure: ${boldMatches.length} bold-header-explanation blocks in a row reads as LLM listicle.`
          );
          count += 1;
        }

        const recordBulletRun = (runLength) => {
          violations.push({
            rule: this.name,
            match: "excessive_bullets",
            context: `Run of ${runLength} consecutive bullet lines`,
            penalty: config.bulletRunPenalty,
          });
          advice.push(`Consider prose instead of this ${runLength}-item bullet list.`);
          count += 1;
        };

        let runLength = 0;
        for (const isBullet of doc.lineIsBullet) {
          if (isBullet) {
            runLength += 1;
            continue;
          }

          if (runLength >= config.bulletRunMin) {
            recordBulletRun(runLength);
          }
          runLength = 0;
        }
        if (runLength >= config.bulletRunMin) {
          recordBulletRun(runLength);
        }

        const triadicMatches = findAll(TRIADIC_RE, doc.text);
        for (const hit of triadicMatches.slice(0, config.triadicRecordCap)) {
          violations.push({
            rule: this.name,
            match: "triadic",
            context: contextAround(doc.text, hit.start, hit.end, config.contextWindowChars),
            penalty: config.triadicPenalty,
          });
          advice.push(
            `Rewrite '${hit.text}' as prose or restructure the list so the sentence does not hinge on a three-item cadence.`
          );
          count += 1;
        }

        if (triadicMatches.length >= config.triadicAdviceMin) {
          advice.push(
            `${triadicMatches.length} triadic structures ('X, Y, and Z'). Vary your list cadence.`
          );
        }

        return result(violations, advice, this.countKey, count);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 4. tone
  // ---------------------------------------------------------------------------

  const META_COMM_PHRASES = [
    "would you like", "let me know if", "as mentioned", "i hope this",
    "feel free to", "don't hesitate to",
  ];

  const FALSE_NARRATIVITY_PHRASES = [
    "then something interesting happened", "this is where things get interesting",
    "that's when everything changed",
  ];

  const SENTENCE_OPENER_PATTERNS = [
    /(?:^|[.!?]\s+)(certainly[,! ])/gim,
    /(?:^|[.!?]\s+)(absolutely[,! ])/gim,
  ];

  function toneMarkerRule(config) {
    return {
      name: "tone",
      countKey: "tone",
      forward(doc) {
        const violations = [];
        const advice = [];

        const record = (hit, penalty, adviceLine) => {
          violations.push({
            rule: "tone",
            match: hit.match,
            context: contextAround(doc.text, hit.start, hit.end, config.contextWindowChars),
            penalty,
          });
          advice.push(adviceLine);
        };

        for (const hit of findLiteralPhrases(doc.lowerText, META_COMM_PHRASES)) {
          record(
            { match: hit.phrase, start: hit.start, end: hit.end },
            config.tonePenalty,
            `Cut '${hit.phrase}'. Replace the invitation with the actual point.`
          );
        }

        for (const hit of findLiteralPhrases(doc.lowerText, FALSE_NARRATIVITY_PHRASES)) {
          record(
            { match: hit.phrase, start: hit.start, end: hit.end },
            config.tonePenalty,
            `Cut '${hit.phrase}'. Replace the announcement with the actual point.`
          );
        }

        if (doc.lowerText.includes("certainly") || doc.lowerText.includes("absolutely")) {
          for (const pattern of SENTENCE_OPENER_PATTERNS) {
            for (const hit of findAll(pattern, doc.text)) {
              const word = hit.groups[0].replace(/^[ ,!]+|[ ,!]+$/g, "").toLowerCase();
              record(
                { match: word, start: hit.start, end: hit.end },
                config.sentenceOpenerPenalty,
                `Cut '${word}' as a sentence opener. Just make the point.`
              );
            }
          }
        }

        return result(violations, advice, this.countKey, violations.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 5. weasel
  // ---------------------------------------------------------------------------

  const WEASEL_PHRASES = [
    "some critics argue", "many believe", "experts suggest", "studies show",
    "some argue", "it is widely believed", "research suggests",
  ];

  function weaselPhraseRule(config) {
    return {
      name: "weasel",
      countKey: "weasel",
      forward(doc) {
        const violations = [];
        const advice = [];

        for (const hit of findLiteralPhrases(doc.lowerText, WEASEL_PHRASES)) {
          violations.push({
            rule: this.name,
            match: hit.phrase,
            context: contextAround(doc.text, hit.start, hit.end, config.contextWindowChars),
            penalty: config.penalty,
          });
          advice.push(`Cut '${hit.phrase}'. Either cite a source or own the claim.`);
        }

        return result(violations, advice, this.countKey, violations.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 6. ai_disclosure
  // ---------------------------------------------------------------------------

  const AI_DISCLOSURE_PHRASES = [
    "as an ai", "as a language model", "i don't have personal", "i cannot browse",
    "up to my last training",
  ];

  const AI_CUTOFF_RE = /\bas of my (last |knowledge )?cutoff\b/gi;
  const AI_JUST_AI_RE = /\bi'm just an? ai\b/gi;

  function aiDisclosureRule(config) {
    return {
      name: "ai_disclosure",
      countKey: "ai_disclosure",
      forward(doc) {
        const violations = [];
        const advice = [];

        const record = (phrase, start, end) => {
          violations.push({
            rule: "ai_disclosure",
            match: phrase,
            context: contextAround(doc.text, start, end, config.contextWindowChars),
            penalty: config.penalty,
          });
          advice.push(
            `Remove '${phrase}'. AI self-disclosure in authored prose is a critical tell.`
          );
        };

        for (const hit of findLiteralPhrases(doc.lowerText, AI_DISCLOSURE_PHRASES)) {
          record(hit.phrase, hit.start, hit.end);
        }

        if (doc.lowerText.includes("as of my") && doc.lowerText.includes("cutoff")) {
          for (const hit of findAll(AI_CUTOFF_RE, doc.text)) {
            record(hit.text.toLowerCase(), hit.start, hit.end);
          }
        }

        if (doc.lowerText.includes("i'm just a")) {
          for (const hit of findAll(AI_JUST_AI_RE, doc.text)) {
            record(hit.text.toLowerCase(), hit.start, hit.end);
          }
        }

        return result(violations, advice, this.countKey, violations.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 7. placeholder
  // ---------------------------------------------------------------------------

  const PLACEHOLDER_RE =
    /\[insert [^\]]*\]|\[describe [^\]]*\]|\[url [^\]]*\]|\[your [^\]]*\]|\[todo[^\]]*\]/gi;

  function placeholderRule(config) {
    return {
      name: "placeholder",
      countKey: "placeholder",
      forward(doc) {
        const violations = [];
        const advice = [];

        for (const hit of findAll(PLACEHOLDER_RE, doc.text)) {
          const value = hit.text.toLowerCase();
          violations.push({
            rule: this.name,
            match: value,
            context: contextAround(doc.text, hit.start, hit.end, config.contextWindowChars),
            penalty: config.penalty,
          });
          advice.push(`Remove placeholder '${value}'. This is unfinished template text.`);
        }

        return result(violations, advice, this.countKey, violations.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 8. rhythm
  // ---------------------------------------------------------------------------

  function rhythmRule(config) {
    return {
      name: "rhythm",
      countKey: "rhythm",
      forward(doc) {
        const lengths = doc.sentenceWordCounts;
        if (lengths.length < config.minSentences) {
          return EMPTY();
        }

        const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
        if (mean <= 0) {
          return EMPTY();
        }

        const variance =
          lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
        const cv = Math.sqrt(variance) / mean;
        if (cv >= config.cvThreshold) {
          return EMPTY();
        }

        const shortest = Math.min(...lengths);
        const longest = Math.max(...lengths);

        return result(
          [
            {
              rule: this.name,
              match: "monotonous_rhythm",
              context: `CV=${fmtFixed(cv, 2)} across ${lengths.length} sentences (mean ${fmtFixed(mean, 1)} words)`,
              penalty: config.penalty,
            },
          ],
          [
            `Sentence lengths are too uniform (CV=${fmtFixed(cv, 2)} < ${fmtFixed(config.cvThreshold, 2)}; shortest ${shortest} words, longest ${longest}, mean ${fmtFixed(mean, 1)}). Add a much shorter or much longer sentence so the passage is not clustered around the same length; aim for roughly a 3x spread between the shortest and longest sentence.`,
          ],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 9. em_dash
  // ---------------------------------------------------------------------------

  const EM_DASH_RE = /—| -- /g;

  function emDashDensityRule(config) {
    return {
      name: "em_dash",
      countKey: "em_dash",
      forward(doc) {
        if (doc.wordCount <= 0) {
          return EMPTY();
        }

        const emDashCount = findAll(EM_DASH_RE, doc.text).length;
        const ratio = (emDashCount / doc.wordCount) * config.wordsBasis;
        if (ratio <= config.densityThreshold) {
          return EMPTY();
        }

        return result(
          [
            {
              rule: this.name,
              match: "em_dash_density",
              context: `${emDashCount} em dashes in ${doc.wordCount} words (${fmtFixed(ratio, 1)} per 150 words)`,
              penalty: config.penalty,
            },
          ],
          [
            `Too many em dashes (${emDashCount} in ${doc.wordCount} words). Use other punctuation.`,
          ],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 10. contrast_pair
  // ---------------------------------------------------------------------------

  const X_NOT_Y_RE = new RegExp(
    `(?<!${WORD_CHAR})(${WORD_CHAR}+), not (${WORD_CHAR}+)(?!${WORD_CHAR})`,
    "gu"
  );

  const STAGED_CONTRAST_RE =
    /\bnot (?:only|just|merely)\b[^.!?\n]{1,80}?\bbut(?: also)?\b[^.!?\n,;:]{1,80}?(?=[,.;:!?]|\n|$)/gi;

  function collectContrastMatches(text) {
    const matches = [];

    for (const hit of findAll(X_NOT_Y_RE, text)) {
      matches.push({ kind: "x_not_y", start: hit.start, end: hit.end, snippet: hit.text });
    }
    for (const hit of findAll(STAGED_CONTRAST_RE, text)) {
      matches.push({
        kind: "staged_contrast",
        start: hit.start,
        end: hit.end,
        snippet: hit.text.trim(),
      });
    }

    matches.sort((a, b) => a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind));
    return matches;
  }

  function contrastPairRule(config) {
    return {
      name: "contrast_pair",
      countKey: "contrast_pairs",
      forward(doc) {
        const matches = collectContrastMatches(doc.text);
        const violations = [];
        const advice = [];

        for (const match of matches.slice(0, config.recordCap)) {
          violations.push({
            rule: this.name,
            match: match.snippet,
            context: contextAround(doc.text, match.start, match.end, config.contextWindowChars),
            penalty: config.penalty,
          });

          advice.push(
            match.kind === "x_not_y"
              ? `Rewrite '${match.snippet}' as a plain sentence with the actual claim instead of an 'X, not Y' slogan.`
              : `Rewrite '${match.snippet}' as a direct sentence instead of staging it as a contrast.`
          );
        }

        if (matches.length >= config.adviceMin) {
          const onlyXNotY = matches.every((match) => match.kind === "x_not_y");
          advice.push(
            onlyXNotY
              ? `${matches.length} 'X, not Y' contrasts. Stop stacking slogan-like oppositions; rewrite at least one as a plain sentence with the actual tradeoff.`
              : `${matches.length} contrast constructions. Stop stacking staged oppositions; rewrite at least one as a plain sentence with the actual tradeoff.`
          );
        }

        return result(violations, advice, this.countKey, violations.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 11. intrasentence_keyword_bold
  // ---------------------------------------------------------------------------

  const BOLD_SPAN_RE = /\*\*([^*\n]+?)\*\*/g;
  const HEADING_LINE_RE = /^\s*#/;
  const KB_BLOCKQUOTE_LINE_RE = /^\s*>/;
  const KB_BULLET_LINE_RE = /^\s*[-*]\s|^\s*\d+[.)]\s/;
  const NUMERIC_BOLD_RE = /^[\s$%€£¥+\-.,]*\d[\s\d.,$%€£¥+\-]*[%a-zA-Z]{0,4}$/;
  const SENTENCE_TERMINATORS = ".!?";

  function lineStartOffsets(text) {
    const offsets = [0];

    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "\n") {
        offsets.push(index + 1);
      }
    }

    return offsets;
  }

  function lineIndexForOffset(lineStarts, offset) {
    let low = 0;
    let high = lineStarts.length;

    while (low < high) {
      const mid = (low + high) >> 1;
      if (lineStarts[mid] <= offset) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return Math.max(0, low - 1);
  }

  function isExcludedLine(line) {
    return (
      HEADING_LINE_RE.test(line) ||
      KB_BLOCKQUOTE_LINE_RE.test(line) ||
      KB_BULLET_LINE_RE.test(line)
    );
  }

  const LABEL_CONTINUATION_RE = /\s+\S/y;

  /** `**Term:** continuation` is a label, and StructuralPatternRule owns it. */
  function isLabelFormWithContinuation(maskedText, matchEnd, innerText) {
    if (!innerText.endsWith(":") && !innerText.endsWith(".")) {
      return false;
    }

    LABEL_CONTINUATION_RE.lastIndex = matchEnd;
    return LABEL_CONTINUATION_RE.test(maskedText);
  }

  function beginsParagraphOrSentence(maskedText, start) {
    let head = maskedText.slice(0, start).replace(/[ \t\r]+$/, "");
    if (!head) {
      return true;
    }
    if (SENTENCE_TERMINATORS.includes(head[head.length - 1])) {
      return true;
    }
    if (head[head.length - 1] !== "\n") {
      return false;
    }

    head = head.slice(0, -1).replace(/[ \t\r]+$/, "");
    if (!head) {
      return true;
    }
    if (head[head.length - 1] === "\n") {
      return true;
    }

    return SENTENCE_TERMINATORS.includes(head[head.length - 1]);
  }

  function collectKeywordBoldMatches(doc, maxWords) {
    const text = doc.text;
    const masked = doc.maskedText;
    const lineStarts = lineStartOffsets(text);
    const survivors = [];

    for (const hit of findAll(BOLD_SPAN_RE, masked)) {
      const inner = hit.groups[0];

      if (isLabelFormWithContinuation(masked, hit.end, inner)) {
        continue;
      }
      if (NUMERIC_BOLD_RE.test(inner)) {
        continue;
      }
      if ((inner.match(/[\p{L}\p{N}_]+/gu) || []).length > maxWords) {
        continue;
      }

      const lineIndex = lineIndexForOffset(lineStarts, hit.start);
      const lineStart = lineStarts[lineIndex];
      const lineEnd =
        lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1] - 1 : text.length;

      if (isExcludedLine(text.slice(lineStart, lineEnd))) {
        continue;
      }
      if (beginsParagraphOrSentence(masked, hit.start)) {
        continue;
      }

      survivors.push({ start: hit.start, end: hit.end, snippet: text.slice(hit.start, hit.end) });
    }

    return survivors;
  }

  function intrasentenceKeywordBoldRule(config) {
    return {
      name: "intrasentence_keyword_bold",
      countKey: "intrasentence_keyword_bold",
      forward(doc) {
        const matches = collectKeywordBoldMatches(doc, config.maxWords);
        const violations = [];
        const advice = [];

        for (const match of matches.slice(0, config.recordCap)) {
          violations.push({
            rule: this.name,
            match: match.snippet,
            context: contextAround(doc.text, match.start, match.end, config.contextWindowChars),
            penalty: config.penalty,
            start: match.start,
            end: match.end,
          });
          advice.push(
            `Drop the mid-sentence bold around '${match.snippet}'. Use plain prose instead of keyword emphasis.`
          );
        }

        if (matches.length >= config.adviceMin) {
          advice.push(
            `${matches.length} mid-sentence keyword bolds. Stop using **emphasis** to highlight keywords inside running prose.`
          );
        }

        // Count true prevalence, not the capped sample, so concentration
        // amplification sees what is actually in the document.
        return result(violations, advice, this.countKey, matches.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 12. setup_resolution
  // ---------------------------------------------------------------------------

  const SETUP_RESOLUTION_A_RE = new RegExp(
    "\\b(this|that|these|those|it|they|we)\\s+" +
      "(isn't|aren't|wasn't|weren't|doesn't|don't|didn't|hasn't|haven't|won't|can't|couldn't|shouldn't" +
      "|is\\s+not|are\\s+not|was\\s+not|were\\s+not|does\\s+not|do\\s+not|did\\s+not" +
      "|has\\s+not|have\\s+not|will\\s+not|cannot|could\\s+not|should\\s+not)\\b" +
      ".{0,80}[.;:,]\\s*" +
      "(it's|they're|that's|he's|she's|we're|it\\s+is|they\\s+are|that\\s+is|this\\s+is" +
      "|these\\s+are|those\\s+are|he\\s+is|she\\s+is|we\\s+are|what's|what\\s+is" +
      "|the\\s+real|the\\s+actual|instead|rather)",
    "gi"
  );

  const SETUP_RESOLUTION_B_RE = new RegExp(
    "\\b(it's|that's|this\\s+is|they're|he's|she's|we're)\\s+not\\b" +
      ".{0,80}[.;:,]\\s*" +
      "(it's|they're|that's|he's|she's|we're|it\\s+is|they\\s+are|that\\s+is|this\\s+is" +
      "|these\\s+are|those\\s+are|what's|what\\s+is|the\\s+real|the\\s+actual|instead|rather)",
    "gi"
  );

  function setupResolutionRule(config) {
    return {
      name: "setup_resolution",
      countKey: "setup_resolution",
      forward(doc) {
        const tokens = doc.wordTokenSetLower;
        if (!doc.lowerText.includes("n't") && !tokens.has("not") && !tokens.has("cannot")) {
          return EMPTY();
        }

        const violations = [];
        const advice = [];
        const seenSpans = new Set();
        let count = 0;

        for (const pattern of [SETUP_RESOLUTION_A_RE, SETUP_RESOLUTION_B_RE]) {
          for (const hit of findAll(pattern, doc.text)) {
            const span = `${hit.start},${hit.end}`;
            if (seenSpans.has(span)) {
              continue;
            }
            seenSpans.add(span);

            if (violations.length < config.recordCap) {
              violations.push({
                rule: this.name,
                match: hit.text,
                context: contextAround(doc.text, hit.start, hit.end, config.contextWindowChars),
                penalty: config.penalty,
              });
              advice.push(
                `'${hit.text}': setup-and-resolution is a Claude rhetorical tic. Just state the point directly.`
              );
            }
            count += 1;
          }
        }

        return result(violations, advice, this.countKey, count);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 13. colon_density
  // ---------------------------------------------------------------------------

  const ELABORATION_COLON_RE = /: [a-z]/g;
  const MD_HEADER_LINE_RE = /^\s*#/;
  const JSON_COLON_RE = /^(?:: ["{[\d]|: true|: false|: null)/;

  function colonDensityRule(config) {
    return {
      name: "colon_density",
      countKey: "colon_density",
      forward(doc) {
        let colonCount = 0;

        for (const line of doc.textWithoutCodeBlocks.split("\n")) {
          if (MD_HEADER_LINE_RE.test(line)) {
            continue;
          }

          for (const hit of findAll(ELABORATION_COLON_RE, line)) {
            const before = line.slice(0, hit.start + 1);
            if (before.endsWith("http:") || before.endsWith("https:")) {
              continue;
            }
            if (JSON_COLON_RE.test(line.slice(hit.start, hit.start + 10))) {
              continue;
            }
            colonCount += 1;
          }
        }

        const strippedWordCount = doc.wordCountWithoutCodeBlocks;
        if (strippedWordCount <= 0) {
          return EMPTY();
        }

        const ratio = (colonCount / strippedWordCount) * config.wordsBasis;
        if (ratio <= config.densityThreshold) {
          return EMPTY();
        }

        return result(
          [
            {
              rule: this.name,
              match: "colon_density",
              context: `${colonCount} elaboration colons in ${strippedWordCount} words (${fmtFixed(ratio, 1)} per 150 words)`,
              penalty: config.penalty,
            },
          ],
          [
            `Too many elaboration colons (${colonCount} in ${strippedWordCount} words). Use periods or restructure sentences.`,
          ],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 14. pithy_fragment
  // ---------------------------------------------------------------------------

  const PITHY_PIVOT_RE = /,\s+(?:but|yet|and|not|or)\b/i;

  function pithyFragmentRule(config) {
    return {
      name: "pithy_fragment",
      countKey: "pithy_fragment",
      forward(doc) {
        const violations = [];
        const advice = [];
        let count = 0;

        doc.sentences.forEach((sentence, index) => {
          if (doc.sentenceWordCounts[index] > config.maxSentenceWords) {
            return;
          }
          if (!PITHY_PIVOT_RE.test(sentence)) {
            return;
          }

          if (count < config.recordCap) {
            violations.push({
              rule: "pithy_fragment",
              match: sentence,
              context: sentence,
              penalty: config.penalty,
            });
            advice.push(
              `Rewrite '${sentence}' as a plain sentence with the actual claim, or cut it if it adds no detail.`
            );
          }
          count += 1;
        });

        return result(violations, advice, this.countKey, count);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 15. bullet_density
  // ---------------------------------------------------------------------------

  function bulletDensityRule(config) {
    return {
      name: "bullet_density",
      countKey: "bullet_density",
      forward(doc) {
        const totalNonEmpty = doc.nonEmptyLines.length;
        if (totalNonEmpty <= 0) {
          return EMPTY();
        }

        const bulletCount = doc.nonEmptyBulletCount;
        const ratio = bulletCount / totalNonEmpty;
        if (ratio <= config.ratioThreshold) {
          return EMPTY();
        }

        return result(
          [
            {
              rule: this.countKey,
              match: "bullet_density",
              context: `${bulletCount} of ${totalNonEmpty} non-empty lines are bullets (${fmtPercent0(ratio)})`,
              penalty: config.penalty,
            },
          ],
          [`Over ${fmtPercent0(ratio)} of lines are bullets. Write prose instead of lists.`],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 16. blockquote_density
  // ---------------------------------------------------------------------------

  function blockquoteDensityRule(config) {
    return {
      name: "structural",
      countKey: "blockquote_density",
      forward(doc) {
        let inCodeBlock = false;
        let blockquoteCount = 0;

        doc.lines.forEach((line, index) => {
          if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            return;
          }
          if (!inCodeBlock && doc.lineIsBlockquote[index]) {
            blockquoteCount += 1;
          }
        });

        if (blockquoteCount < config.minLines) {
          return EMPTY();
        }

        const capped = Math.min(blockquoteCount - config.freeLines, config.cap);

        return result(
          [
            {
              rule: this.countKey,
              match: "blockquote_density",
              context: `${blockquoteCount} blockquote lines: Claude uses these as thesis statements`,
              penalty: config.penaltyStep * capped,
            },
          ],
          [
            `${blockquoteCount} blockquotes. Integrate key claims into prose instead of pulling them out as blockquotes.`,
          ],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 17. bold_term_bullet_run
  // ---------------------------------------------------------------------------

  function boldTermBulletRunRule(config) {
    return {
      name: "structural",
      countKey: "bold_bullet_list",
      forward(doc) {
        const violations = [];
        const advice = [];
        let count = 0;

        const record = (run) => {
          violations.push({
            rule: "bold_bullet_list",
            match: "bold_bullet_list",
            context: `Run of ${run} bold-term bullets`,
            penalty: config.penalty,
          });
          advice.push(
            `Run of ${run} bold-term bullets. This is an LLM listicle pattern. Use varied paragraph structure.`
          );
          count += 1;
        };

        let run = 0;
        for (const isBoldTermBullet of doc.lineIsBoldTermBullet) {
          if (isBoldTermBullet) {
            run += 1;
            continue;
          }

          if (run >= config.minRunLength) {
            record(run);
          }
          run = 0;
        }
        if (run >= config.minRunLength) {
          record(run);
        }

        return result(violations, advice, this.countKey, count);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 18. horizontal_rule_overuse
  // ---------------------------------------------------------------------------

  const HORIZONTAL_RULE_RE = /^\s*(?:---+|\*\*\*+|___+)\s*$/gm;

  function horizontalRuleOveruseRule(config) {
    return {
      name: "structural",
      countKey: "horizontal_rules",
      forward(doc) {
        const count = findAll(HORIZONTAL_RULE_RE, doc.text).length;
        if (count < config.minCount) {
          return EMPTY();
        }

        return result(
          [
            {
              rule: this.countKey,
              match: "horizontal_rules",
              context: `${count} horizontal rules: excessive section dividers`,
              penalty: config.penalty,
            },
          ],
          [
            `${count} horizontal rules. Section headers alone are sufficient, dividers are a crutch.`,
          ],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 19. phrase_reuse
  // ---------------------------------------------------------------------------

  function phraseReuseRule(config) {
    return {
      name: "phrase_reuse",
      countKey: "phrase_reuse",
      forward(doc) {
        const tokens = doc.ngramTokensLower;
        if (tokens.length < config.repeatedNgramMinN) {
          return EMPTY();
        }

        if (config.repeatedNgramMinN > 1) {
          const hasPrefixRepeat = hasRepeatedNgramPrefix(
            tokens,
            config.repeatedNgramMinN - 1,
            config.repeatedNgramMinCount
          );
          if (!hasPrefixRepeat) {
            return EMPTY();
          }
        }

        const repeated = findRepeatedNgrams(
          tokens,
          config.repeatedNgramMinN,
          config.repeatedNgramMaxN,
          config.repeatedNgramMinCount
        );

        const violations = [];
        const advice = [];

        for (const ngram of repeated.slice(0, config.recordCap)) {
          violations.push({
            rule: this.name,
            match: ngram.phrase,
            context: `'${ngram.phrase}' (${ngram.n}-word phrase) appears ${ngram.count} times`,
            penalty: config.penalty,
          });
          advice.push(
            `'${ngram.phrase}' appears ${ngram.count} times. Vary your phrasing to avoid repetition.`
          );
        }

        return result(violations, advice, this.countKey, violations.length);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 20. copula_chain
  // ---------------------------------------------------------------------------

  const COPULA_FIRST_WORDS_RE = /\b(is|are|was|were)\b/i;

  function copulaChainRule(config) {
    return {
      name: "copula_chain",
      countKey: "copula_chain",
      forward(doc) {
        if (doc.sentences.length < config.minSentences) {
          return EMPTY();
        }

        const copulaCount = doc.sentences.filter((sentence) =>
          COPULA_FIRST_WORDS_RE.test(splitWs(sentence).slice(0, 6).join(" "))
        ).length;

        const density = copulaCount / doc.sentences.length;
        if (density < config.threshold) {
          return EMPTY();
        }

        return result(
          [
            {
              rule: this.name,
              match: "copula_density",
              context: `${copulaCount}/${doc.sentences.length} sentences (${fmtPercent0(density)}) use a copula within the first 6 words`,
              penalty: config.penalty,
            },
          ],
          [
            `Copula density is ${fmtPercent0(density)} - too many 'X is Y' sentences. Use active verbs or restructure to vary sentence patterns.`,
          ],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 21. extreme_sentence
  // ---------------------------------------------------------------------------

  function extremeSentenceRule(config) {
    return {
      name: "extreme_sentence",
      countKey: "extreme_sentence",
      forward(doc) {
        const violations = [];
        const advice = [];
        let count = 0;

        doc.sentenceAnalysisSentences.forEach((sentence, index) => {
          const words = doc.sentenceAnalysisWordCounts[index];
          if (words < config.minWords) {
            return;
          }

          const preview =
            sentence.length > 80 ? `"${sentence.slice(0, 80)}..."` : `"${sentence}"`;

          violations.push({
            rule: "extreme_sentence",
            match: "run_on_sentence",
            context: `Sentence ${index + 1} has ${words} words (>= ${config.minWords}): ${preview}`,
            penalty: config.penalty,
          });
          advice.push(`Sentence ${index + 1} is ${words} words - break it into shorter sentences.`);
          count += 1;
        });

        return result(violations, advice, this.countKey, count);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 22. closing_aphorism
  // ---------------------------------------------------------------------------

  const CLOSING_APHORISM_PATTERNS = [
    /^sometimes\b/i,
    /\bisn't\b.{1,40}\bit's\b/i,
    /\bnot\b.{1,30}\bit's\b.{1,40}$/i,
    /^the (real|true|actual|biggest|greatest|most important)\b/i,
    /^(in the end|ultimately|at the end of the day)\b/i,
    /\bwe (bring|carry|create|make|build|choose)\b/i,
    /^that's (the |what |where |why |how )/i,
    /^it (all )?(comes|boils) down to\b/i,
  ];

  const MIN_APHORISM_PATTERN_MATCHES = 2;

  function closingAphorismRule(config) {
    return {
      name: "closing_aphorism",
      countKey: "closing_aphorism",
      forward(doc) {
        if (doc.sentences.length < config.minSentences) {
          return EMPTY();
        }

        const last = doc.sentences[doc.sentences.length - 1];
        const matches = CLOSING_APHORISM_PATTERNS.filter((pattern) => pattern.test(last)).length;
        if (matches < MIN_APHORISM_PATTERN_MATCHES) {
          return EMPTY();
        }

        const preview = last.length > 80 ? `"${last.slice(0, 80)}..."` : `"${last}"`;

        return result(
          [
            {
              rule: this.name,
              match: "closing_aphorism",
              context: `Closing sentence matches ${matches} generalizing patterns: ${preview}`,
              penalty: config.penalty,
            },
          ],
          [
            "Your closing sentence is a tidy generalization - a strong AI tell. End on a specific detail, a fragment, or just stop.",
          ],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 23 & 24. paragraph_balance / paragraph_cv
  // ---------------------------------------------------------------------------

  const PARAGRAPH_SPLIT_RE = /\n\s*\n/;

  function paragraphWordCounts(text) {
    return text
      .split(PARAGRAPH_SPLIT_RE)
      .filter((paragraph) => paragraph.trim().length > 0)
      .map((paragraph) => splitWs(paragraph).length);
  }

  function paragraphBalanceRule(config) {
    return {
      name: "paragraph_balance",
      countKey: "paragraph_balance",
      forward(doc) {
        const lengths = paragraphWordCounts(doc.text);
        if (lengths.length < config.minBodyParagraphs + 1) {
          return EMPTY();
        }

        const body = lengths.slice(1);
        const maxLen = Math.max(...body);
        if (maxLen === 0) {
          return EMPTY();
        }

        const ratio = Math.min(...body) / maxLen;
        if (ratio <= config.balanceThreshold) {
          return EMPTY();
        }

        return result(
          [
            {
              rule: this.name,
              match: "paragraph_balance",
              context: `Body paragraph word counts [${body.join(", ")}] - balance ratio ${fmtFixed(ratio, 2)} (> ${config.balanceThreshold})`,
              penalty: config.penalty,
            },
          ],
          [
            `Body paragraphs are suspiciously uniform in length (ratio ${fmtFixed(ratio, 2)}). Vary paragraph sizes - some should be two sentences, some should sprawl.`,
          ],
          this.countKey,
          1
        );
      },
    };
  }

  function paragraphCvRule(config) {
    return {
      name: "paragraph_cv",
      countKey: "paragraph_cv",
      forward(doc) {
        const lengths = paragraphWordCounts(doc.text);
        if (lengths.length < config.minParagraphs) {
          return EMPTY();
        }

        const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
        if (mean <= 0) {
          return EMPTY();
        }

        const variance =
          lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
        const cv = Math.sqrt(variance) / mean;
        if (cv >= config.cvThreshold) {
          return EMPTY();
        }

        return result(
          [
            {
              rule: this.name,
              match: "paragraph_cv",
              context: `Paragraph length CV=${fmtFixed(cv, 2)} (< ${fmtFixed(config.cvThreshold, 2)}) across lengths [${lengths.join(", ")}]`,
              penalty: config.penalty,
            },
          ],
          [
            `Paragraph lengths are too uniform (CV=${fmtFixed(cv, 2)}). Mix short punchy paragraphs with longer developed ones.`,
          ],
          this.countKey,
          1
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Default pipeline (mirrors rules/assets/default.jsonl, in order)
  // ---------------------------------------------------------------------------

  function defaultPipeline() {
    return [
      slopWordRule({ penalty: -2, contextWindowChars: 60 }),
      slopPhraseRule({ penalty: -3, contextWindowChars: 60 }),
      structuralPatternRule({
        boldHeaderMin: 3,
        boldHeaderPenalty: -5,
        bulletRunMin: 6,
        bulletRunPenalty: -3,
        triadicRecordCap: 5,
        triadicPenalty: -1,
        triadicAdviceMin: 3,
        contextWindowChars: 60,
      }),
      toneMarkerRule({ tonePenalty: -3, sentenceOpenerPenalty: -2, contextWindowChars: 60 }),
      weaselPhraseRule({ penalty: -2, contextWindowChars: 60 }),
      aiDisclosureRule({ penalty: -10, contextWindowChars: 60 }),
      placeholderRule({ penalty: -5, contextWindowChars: 60 }),
      rhythmRule({ minSentences: 5, cvThreshold: 0.3, penalty: -5 }),
      emDashDensityRule({ wordsBasis: 150.0, densityThreshold: 1.0, penalty: -3 }),
      contrastPairRule({ penalty: -1, recordCap: 5, adviceMin: 2, contextWindowChars: 60 }),
      intrasentenceKeywordBoldRule({
        penalty: -2,
        recordCap: 5,
        adviceMin: 3,
        maxWords: 5,
        contextWindowChars: 60,
      }),
      setupResolutionRule({ penalty: -3, recordCap: 5, contextWindowChars: 60 }),
      colonDensityRule({ wordsBasis: 150.0, densityThreshold: 1.5, penalty: -3 }),
      pithyFragmentRule({ penalty: -2, maxSentenceWords: 6, recordCap: 3 }),
      bulletDensityRule({ penalty: -8, ratioThreshold: 0.4 }),
      blockquoteDensityRule({ minLines: 3, freeLines: 2, cap: 4, penaltyStep: -3 }),
      boldTermBulletRunRule({ minRunLength: 3, penalty: -5 }),
      horizontalRuleOveruseRule({ minCount: 4, penalty: -3 }),
      phraseReuseRule({
        penalty: -1,
        recordCap: 5,
        repeatedNgramMinN: 4,
        repeatedNgramMaxN: 8,
        repeatedNgramMinCount: 3,
      }),
      copulaChainRule({ minSentences: 6, threshold: 0.5, penalty: -3 }),
      extremeSentenceRule({ minWords: 140, penalty: -5 }),
      closingAphorismRule({ minSentences: 4, penalty: -4 }),
      paragraphBalanceRule({ minBodyParagraphs: 3, balanceThreshold: 0.7, penalty: -6 }),
      paragraphCvRule({ minParagraphs: 5, cvThreshold: 0.45, penalty: -1 }),
    ];
  }

  root.SlopGuard = Object.assign(root.SlopGuard || {}, { defaultPipeline });
})(typeof globalThis !== "undefined" ? globalThis : this);
