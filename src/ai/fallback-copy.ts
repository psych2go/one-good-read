import type { PublicRecommendationCopy, RankedCandidate } from "../domain/types";

/**
 * Deterministic public copy used when the AI copywriter is unavailable.
 *
 * Built from the winner's own analysis (evidence, context summary, themes, keywords, scores) and
 * rotated across several phrasings seeded by date + article id, so consecutive outage days do not
 * publish identical boilerplate. Keywords are normalized and padded so valid-but-repeated analysis
 * keywords never make the outage fallback fail public-copy validation.
 */
export function fallbackRecommendationCopy(winner: RankedCandidate, date = ""): PublicRecommendationCopy {
  const analysis = winner.analysis;
  const theme = clean(analysis.primaryTheme) || "长期思考";
  const keywords = publicKeywords(theme, analysis.keywords);
  const seed = hash(`${date}|${winner.articleId}`);
  const pick = <T>(items: readonly T[], salt: number): T => items[(seed + salt) % items.length] as T;

  const focus = keywords.filter((keyword) => keyword !== theme).slice(0, 2);
  const focusText = focus.length ? focus.map((keyword) => `“${keyword}”`).join("与") : `“${theme}”`;
  const strength = STRENGTH_LABELS[strongestDimension(analysis.scores)];
  const highlight = articleHighlight(analysis.evidence, analysis.contextSummary);

  const openers = [
    `这篇文章从${focusText}切入，讨论“${theme}”。`,
    `围绕“${theme}”，作者把注意力放在${focusText}上。`,
    `这是一篇关于“${theme}”的文章，重点落在${focusText}。`,
    `如果关心“${theme}”，这篇文章提供了一个以${focusText}为线索的观察角度。`,
  ] as const;
  const closers = [
    `它在${strength}上尤其突出，适合带着自己的判断去读。`,
    `分析中它的${strength}最突出，值得慢读并检验其中的推理。`,
    `它最强的是${strength}，结论之外，论证过程本身也值得留意。`,
    `它的${strength}较为突出，可以对照自己已有的看法来读。`,
  ] as const;
  const opener = pick(openers, 0);
  const closer = pick(closers, 1);
  const budget = 236 - opener.length - closer.length;
  const middle = highlight ? truncateAtPunctuation(highlight, Math.min(120, budget)) : "";
  let whyWorthReading = `${opener}${middle}${closer}`;
  if (whyWorthReading.trim().length < 40) whyWorthReading = `${opener}${closer}它不提供速成答案，更适合用来重新组织问题、判断证据。`;

  const secondary = (analysis.secondaryThemes ?? []).map(clean).filter((value) => value && value !== theme).slice(0, 2);
  const minutes = winner.readingMinutes > 0 ? `约 ${Math.round(winner.readingMinutes)} 分钟` : "篇幅适中";
  const bridge = secondary.length ? `“${secondary.join("”“")}”` : focusText;
  const neighbour = secondary[0] ? `“${secondary[0]}”` : focusText;
  let whyToday: string;
  if (winner.explorationBonus > 0.3) {
    whyToday = pick([
      `近期推荐较少涉及“${theme}”。今天换到这个方向，在不降低质量门槛的前提下，为不太熟悉但可能重要的知识留出探索空间。`,
      `最近的阅读主题集中在别处，今天转向“${theme}”，顺带连到${bridge}，读完${minutes}，算是一次有分寸的主题切换。`,
      `今天选它，是想把视线从近期常见主题移到“${theme}”。它与${bridge}相关，${minutes}，适合作为探索性的一读。`,
    ], 2);
  } else if (winner.freshnessBonus >= 0.4) {
    whyToday = pick([
      `这是候选池里较新的一篇，围绕${focusText}的讨论仍有时效。${minutes}，适合趁新读完再形成自己的判断。`,
      `它发表不久，又与${bridge}相关，今天读能赶上讨论的新鲜度；${minutes}，节奏不重。`,
    ], 2);
  } else {
    whyToday = pick([
      `在今天的候选中，它的长期价值与${strength}兼顾，又与近期推荐的作者和主题错开。${minutes}，适合完整读完。`,
      `今天的推荐想在“${theme}”与${neighbour}之间搭一座桥，它恰好处在两者交汇处；${minutes}，不必赶。`,
      `它与近期推荐的作者、主题不重复，又能在${focusText}上补一层更扎实的理解。${minutes}，适合留出一段完整时间。`,
      `今天选它，是因为它的${strength}在候选中靠前，而且话题落在${bridge}，与最近几天的阅读形成互补。${minutes}。`,
    ], 2);
  }
  if (whyToday.length > 200) whyToday = truncateAtPunctuation(whyToday, 198);
  return { whyWorthReading, whyToday, keywords };
}

const STRENGTH_LABELS = {
  longTermValue: "长期价值",
  ideaDensity: "思想密度",
  argumentQuality: "论证质量",
  originality: "原创性",
  clarityStructure: "结构清晰度",
} as const;

type ScoreKey = keyof typeof STRENGTH_LABELS;

function strongestDimension(scores: Partial<Record<ScoreKey, number>> | undefined): ScoreKey {
  let best: ScoreKey = "longTermValue";
  let bestScore = -Infinity;
  for (const key of Object.keys(STRENGTH_LABELS) as ScoreKey[]) {
    const value = scores?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > bestScore) { best = key; bestScore = value; }
  }
  return best;
}

/** One reader-facing sentence about the article itself: prefer evidence, else the context summary (never the internal 盲评 notes). */
function articleHighlight(evidence: string[] | undefined, contextSummary: string | undefined): string {
  const candidates = [
    ...(evidence ?? []).flatMap((item) => sentences(item)),
    ...sentences(contextSummary ?? "").filter((sentence) => /认为|主张|提出|讨论|分析|指出|强调/.test(sentence)),
  ];
  const usable = candidates.filter((sentence) => sentence.length >= 15 && !/盲评|评分|作者身份|知名度|DELIM|\?/.test(sentence));
  const chosen = usable[0];
  if (!chosen) return "";
  const body = chosen.replace(/^(?:本文|文章|全文|作者)(?:的)?/, "");
  return /[。！？]$/.test(body) ? `文中${body}` : `文中${body}。`;
}

function sentences(text: string): string[] {
  return clean(text).split(/(?<=[。！？；])/).map((part) => part.trim().replace(/；$/, "。")).filter(Boolean);
}

function truncateAtPunctuation(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(slice.lastIndexOf("，"), slice.lastIndexOf("、"), slice.lastIndexOf("；"), slice.lastIndexOf("："));
  return `${(cut > max * 0.5 ? slice.slice(0, cut) : slice.slice(0, max - 1))}。`;
}

function publicKeywords(theme: string, raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const keywords = [...new Set([theme, ...list]
    .filter((value): value is string => typeof value === "string")
    .map(clean)
    .filter((value) => value.length > 0 && value.length <= 80 && !/[?？]|wait/i.test(value)))].slice(0, 5);
  // Neutral labels describe the reading activity, not unverified article claims.
  for (const label of ["阅读", "思考", "观点"]) {
    if (keywords.length >= 3) break;
    if (!keywords.includes(label)) keywords.push(label);
  }
  return keywords;
}

/** Strip model control tokens and invisible characters that occasionally leak into analysis fields. */
function clean(value: string | undefined): string {
  return String(value ?? "")
    .replace(/<\|[^|>]*\|>/g, "")
    .replace(/[\u200b-\u200f\u2060\ufeff\ufffc]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hash(value: string): number {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) { h ^= value.charCodeAt(index); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
