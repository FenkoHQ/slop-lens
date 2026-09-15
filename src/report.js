/**
 * Builds the report DOM.
 *
 * Shared by the popup and the file scorer so both surfaces read identically.
 * The caller supplies a scan result and says whether hits are clickable; the
 * action row is the caller's own business.
 */
(function (root) {
  "use strict";

  const SCORE_MAX = 100;
  const ADVICE_SHOWN = 5;
  const HITS_SHOWN = 12;

  // Share of total penalty at which a signal group is drawn as severe.
  const TICK_CRITICAL_SHARE = 0.25;
  const TICK_HIGH_SHARE = 0.1;

  const BANDS = ["clean", "light", "moderate", "heavy", "saturated"];

  const BAND_BLURB = {
    clean: "Reads like a person wrote it.",
    light: "A few tells, nothing damning.",
    moderate: "Recognisable model cadence.",
    heavy: "Heavy formulaic patterning.",
    saturated: "Dense with generated-text tells.",
  };

  const RULE_LABELS = {
    slop_word: "Overused vocabulary",
    slop_phrase: "Stock phrases",
    structural: "Listicle structure",
    tone: "Assistant tone",
    weasel: "Unattributed claims",
    ai_disclosure: "AI self-disclosure",
    placeholder: "Unfinished placeholders",
    rhythm: "Uniform sentence rhythm",
    em_dash: "Em-dash density",
    contrast_pair: "Contrast constructions",
    intrasentence_keyword_bold: "Mid-sentence bold",
    setup_resolution: "Setup-and-resolution tic",
    colon_density: "Elaboration colons",
    pithy_fragment: "Pithy fragments",
    bullet_density: "Bullet dominance",
    blockquote_density: "Blockquote overuse",
    bold_bullet_list: "Bold-term bullet runs",
    horizontal_rules: "Divider overuse",
    phrase_reuse: "Repeated phrasing",
    copula_chain: "“X is Y” chains",
    extreme_sentence: "Run-on sentences",
    closing_aphorism: "Moralising close",
    paragraph_balance: "Uniform paragraph sizes",
    paragraph_cv: "Uniform paragraph rhythm",
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }

    return node;
  }

  function groupViolations(violations) {
    const groups = new Map();

    violations.forEach((violation, index) => {
      const bucket = groups.get(violation.rule) || [];
      bucket.push({ violation, index });
      groups.set(violation.rule, bucket);
    });

    return [...groups.entries()]
      .map(([rule, entries]) => ({
        rule,
        entries,
        weight: entries.reduce((sum, e) => sum + Math.abs(e.violation.penalty), 0),
      }))
      .sort((a, b) => b.weight - a.weight || b.entries.length - a.entries.length);
  }

  function tickTone(share) {
    if (share >= TICK_CRITICAL_SHARE) {
      return "var(--band-saturated)";
    }
    if (share >= TICK_HIGH_SHARE) {
      return "var(--band-heavy)";
    }

    return "var(--band-moderate)";
  }

  /** Context snippets carry the Markdown we synthesized; drop the markers. */
  function readable(text) {
    return text.replace(/\*\*/g, "").replace(/`/g, "");
  }

  function hitLabel(violation) {
    // Density and structure rules report a computed context, not a quote.
    if (violation.match === violation.context || violation.context.includes(violation.match)) {
      return { quote: violation.match, tail: "" };
    }

    return { quote: "", tail: violation.context };
  }

  function renderHit(entry, onJump) {
    const button = element("button", onJump ? "hit" : "hit no-jump");
    button.type = "button";

    const label = hitLabel(entry.violation);
    if (label.quote) {
      button.appendChild(element("span", "quote", `“${readable(label.quote)}”`));
      button.append(` ${readable(entry.violation.context)}`);
    } else {
      button.textContent = readable(label.tail);
    }

    if (onJump) {
      button.addEventListener("click", () => onJump(entry.index));
    } else {
      button.disabled = true;
    }

    return button;
  }

  function caret() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "caret");
    svg.setAttribute("viewBox", "0 0 10 10");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3.5 1.5 L7 5 L3.5 8.5");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);

    return svg;
  }

  function renderVerdict(analysis, slop) {
    const verdict = element("div", "verdict");

    const readout = element("div", "readout");
    readout.title = `slop-guard score: ${analysis.score}/100`;
    readout.append(
      element("span", "score", String(slop)),
      element("span", "score-max", "/100")
    );

    const text = element("div", "verdict-text");
    text.append(
      element("p", "band", analysis.band),
      element("p", "blurb", BAND_BLURB[analysis.band])
    );

    verdict.append(readout, text);
    return verdict;
  }

  function renderRail(analysis, slop) {
    const rail = element("div", "rail");
    rail.setAttribute("role", "img");
    rail.setAttribute("aria-label", `Slop ${slop} of 100, band ${analysis.band}`);

    const track = element("div", "rail-track");
    for (const band of BANDS) {
      const segment = element("span", band === analysis.band ? "seg on" : "seg");
      segment.dataset.band = band;
      track.appendChild(segment);
    }

    // Clamped so the marker stays inside the track at either extreme.
    const marker = element("span", "marker");
    marker.style.setProperty("--at", `${Math.min(99, Math.max(1, slop))}%`);
    track.appendChild(marker);

    const scale = element("div", "rail-scale");
    scale.append(element("span", "", "clean"), element("span", "", "saturated"));

    rail.append(track, scale);
    return rail;
  }

  function renderRules(analysis, onJump) {
    const list = element("ul", "rules");
    const groups = groupViolations(analysis.violations);
    const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0) || 1;

    for (const group of groups) {
      const details = element("details", "rule");
      const summary = document.createElement("summary");

      const tick = element("i", "tick");
      tick.style.setProperty("--tone", tickTone(group.weight / totalWeight));

      summary.append(
        tick,
        element("span", "rule-name", RULE_LABELS[group.rule] || group.rule),
        element("span", "rule-count", String(group.entries.length)),
        caret()
      );
      details.appendChild(summary);

      const hits = element("ul", "hits");
      for (const entry of group.entries.slice(0, HITS_SHOWN)) {
        const item = document.createElement("li");
        item.appendChild(renderHit(entry, onJump));
        hits.appendChild(item);
      }

      details.appendChild(hits);
      list.appendChild(details);
    }

    return list;
  }

  function renderAdvice(analysis) {
    const list = element("ol", "advice");

    if (analysis.advice.length === 0) {
      list.appendChild(element("li", "", "Nothing flagged."));
      return list;
    }

    for (const line of analysis.advice.slice(0, ADVICE_SHOWN)) {
      list.appendChild(element("li", "", line));
    }

    return list;
  }

  function heading(text) {
    return element("h2", "", text);
  }

  /**
   * Build a report section for one scan.
   *
   * `options.subject` names what was scored, `options.onJump` makes hits
   * clickable, and `options.actions` is an element dropped in below the meta
   * line for whatever controls the caller owns.
   */
  function build(scan, options) {
    const settings = options || {};
    const analysis = scan.analysis;

    // Everything on screen counts slop upward. slop-guard's own score counts
    // cleanliness upward, so it is inverted once, here.
    const slop = SCORE_MAX - analysis.score;

    const section = element("section", "report");
    section.style.setProperty("--tone", `var(--band-${analysis.band})`);

    const signals = analysis.violations.length;
    const meta = element(
      "p",
      "meta",
      [
        `${analysis.word_count} words${settings.subject ? ` in ${settings.subject}` : ""}`,
        `${signals} signal${signals === 1 ? "" : "s"}`,
        `${analysis.density} penalty per 1k words`,
      ].join("  ·  ")
    );

    section.append(renderVerdict(analysis, slop), renderRail(analysis, slop), meta);

    if (settings.actions) {
      section.appendChild(settings.actions);
    }

    section.append(
      heading("Signals"),
      renderRules(analysis, settings.onJump),
      heading("Fix these first"),
      renderAdvice(analysis)
    );

    return section;
  }

  root.SlopLens = Object.assign(root.SlopLens || {}, {
    report: { BANDS, SCORE_MAX, build },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
