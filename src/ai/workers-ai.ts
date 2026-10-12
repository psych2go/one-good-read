import { invalidContentEligibility, parseContentEligibility } from "../domain/content-gate";
import { weightedIntrinsicScore } from "../domain/scoring";
import type { ArticleAnalysis, ExtractedArticle, PublicRecommendationCopy, RankedCandidate } from "../domain/types";
import type { AiProvider, AiProbeResult, AnalysisContext } from "./provider";
import {
  BLIND_SYSTEM_PROMPT,
  THEMES,
  blindSchema,
  chunkForAnalysis,
  contextSchema,
  minimalCandidate,
  wait,
  type BlindResult,
  type ContextResult,
} from "./openai";

/** Workers AI analysis via the WORKERS_AI binding (no external relay / API key). */
export class WorkersAiProvider implements AiProvider {
  readonly name = "workers-ai";
  constructor(private readonly ai: Ai, readonly model: string) {}

  async probe(): Promise<AiProbeResult> {
    const result = await this.callJson<{ ok: boolean; message: string }>(
      {
        type: "object",
        additionalProperties: false,
        required: ["ok", "message"],
        properties: { ok: { type: "boolean" }, message: { type: "string", maxLength: 120 } },
      },
      "Return a JSON object confirming structured output support. Set ok to true and message to a short confirmation.",
      "Probe the Workers AI structured-output path.",
      256,
    );
    return { provider: this.name, model: this.model, structuredOutput: Boolean(result.ok), message: result.message };
  }

  async analyze(article: ExtractedArticle, context: AnalysisContext): Promise<ArticleAnalysis> {
    const blind = await this.analyzeBlindText(article.text);
    const contextual = await this.callJson<ContextResult>(
      contextSchema,
      `你是长期阅读策展编辑。结合作者、发布日期和盲评结果进行主题与上下文判断。规范主题只能从给定列表中选择：${THEMES.join("、")}。不得因为作者知名度提高内在质量分。`,
      JSON.stringify({ title: article.title, author: article.author, publishedAt: article.publishedAt, url: article.canonicalUrl, blind }),
      2_048,
    );
    const repairedEligibility = repairContentEligibility(blind.contentEligibility);
    const contentEligibility =
      parseContentEligibility(repairedEligibility, article.text)
      ?? parseContentEligibility(repairedEligibility)
      ?? invalidContentEligibility();
    if (contentEligibility.reason === "invalid_or_missing_eligibility") {
      blind.riskNotes = [
        ...blind.riskNotes,
        `eligibility_raw:${JSON.stringify(blind.contentEligibility).slice(0, 500)}`,
      ].slice(0, 5);
    }
    const scores = {
      longTermValue: blind.longTermValue,
      ideaDensity: blind.ideaDensity,
      argumentQuality: blind.argumentQuality,
      originality: blind.originality,
      clarityStructure: blind.clarityStructure,
    };
    return {
      contentEligibility,
      articleId: context.articleId,
      analysisVersion: context.analysisVersion,
      provider: this.name,
      model: this.model,
      scores,
      intrinsicScore: weightedIntrinsicScore(scores),
      extractionConfidence: article.extractionConfidence,
      analysisConfidence: Math.min(blind.confidence, contextual.confidence),
      primaryTheme: contextual.primaryTheme,
      secondaryThemes: contextual.secondaryThemes,
      keywords: contextual.keywords,
      evidence: blind.evidence,
      riskNotes: blind.riskNotes,
      contextSummary: contextual.contextSummary,
    };
  }

  async choose(candidates: RankedCandidate[], recentSummary: string): Promise<{ articleId: string; rationale: string }> {
    const result = await this.callJson<{ articleId: string; rationale: string }>(
      {
        type: "object",
        additionalProperties: false,
        required: ["articleId", "rationale"],
        properties: { articleId: { type: "string" }, rationale: { type: "string" } },
      },
      "你是克制的每日阅读编辑。只能从给定Top候选中选择一篇。质量优先，尊重作者与主题疲劳、探索和新文信号。不得选择列表外文章。",
      JSON.stringify({ recentSummary, candidates: candidates.map(minimalCandidate) }),
      1_024,
    );
    if (!candidates.some((candidate) => candidate.articleId === result.articleId)) throw new Error("AI selected an article outside Top candidates");
    return result;
  }

  async writeRecommendation(winner: RankedCandidate, recentSummary: string): Promise<PublicRecommendationCopy> {
    return this.callJson<PublicRecommendationCopy>(
      {
        type: "object",
        additionalProperties: false,
        required: ["whyWorthReading", "whyToday", "keywords"],
        properties: {
          whyWorthReading: { type: "string", minLength: 40, maxLength: 240 },
          whyToday: { type: "string", minLength: 30, maxLength: 200 },
          keywords: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
        },
      },
      "用简体中文写克制的推荐说明。不要总结全文，不提前讲完结论，不虚构用户状态，不把推荐写成事实背书。为什么值得读60-120字；为什么今天40-100字。",
      JSON.stringify({ recentSummary, winner: minimalCandidate(winner) }),
      1_024,
    );
  }

  private async analyzeBlindText(text: string): Promise<BlindResult> {
    const chunks = chunkForAnalysis(text);
    if (chunks.length === 1) {
      return this.callJson<BlindResult>(
        blindSchema,
        `${BLIND_SYSTEM_PROMPT}\nbodyEvidence 必须是正文中的连续原句子串，逐字复制，不得改写、省略或翻译。`,
        `正文：\n${text}`,
        4_096,
      );
    }
    const chunkResults: Array<{ index: number; characters: number; analysis: BlindResult }> = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] ?? "";
      const analysis = await this.callJson<BlindResult>(
        blindSchema,
        `${BLIND_SYSTEM_PROMPT} 这是长文的第 ${index + 1}/${chunks.length} 段。只评估本段提供的思想与论证，证据必须来自本段。`,
        `正文片段：\n${chunk}`,
        4_096,
      );
      chunkResults.push({ index, characters: chunk.length, analysis });
    }
    return this.callJson<BlindResult>(
      blindSchema,
      `${BLIND_SYSTEM_PROMPT} 你是长文总评编辑。根据所有分段分析形成整篇文章的盲评。不要机械平均；考虑观点如何跨段展开、重复、深化或受限。资格判断针对整篇，不因单段引用而拒绝完整文章。bodyEvidence 保留分段中的正文原句。`,
      JSON.stringify({ totalCharacters: text.length, chunks: chunkResults }),
      4_096,
    );
  }

  private async callJson<T>(schema: Record<string, unknown>, system: string, input: string, maxTokens: number): Promise<T> {
    let lastError = "unknown error";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        // Model id is configured at deploy time; cast keeps Workers AI binding typings flexible.
        const output = await (this.ai as { run: (model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }).run(
          this.model,
          {
            messages: [
              { role: "system", content: system },
              { role: "user", content: input },
            ],
            response_format: { type: "json_schema", json_schema: schema },
            max_tokens: maxTokens,
          },
          { signal: AbortSignal.timeout(120_000), tags: ["one-good-read", "analysis"] },
        );
        const text = extractWorkersAiJsonText(output);
        if (!text) throw new Error("Workers AI response did not contain JSON text");
        return JSON.parse(text) as T;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < 3 && /timeout|network|fetch|429|5\d\d|capacity|busy|JSON Mode/i.test(lastError)) {
          await wait(attempt * 2_000);
          continue;
        }
        throw error instanceof Error ? error : new Error(lastError);
      }
    }
    throw new Error(`Workers AI request failed after retries: ${lastError}`);
  }
}


function repairContentEligibility(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const item = { ...(value as Record<string, unknown>) };
  if (typeof item.version === "string") item.version = item.version.trim();
  if (typeof item.format === "string") item.format = item.format.trim().replace(/\s+/g, "_");
  if (typeof item.reason === "string") item.reason = item.reason.trim();
  if (typeof item.bodyEvidence === "string" && item.bodyEvidence.trim()) item.bodyEvidence = [item.bodyEvidence.trim()];
  if (Array.isArray(item.bodyEvidence)) {
    item.bodyEvidence = item.bodyEvidence
      .map((quote) => typeof quote === "string" ? quote.trim() : quote)
      .filter((quote) => typeof quote === "string" && quote.length > 0)
      .slice(0, 5);
  }
  // Common model drift: 0-1 scores mistakenly mirrored into unrelated fields — leave scores alone.
  return item;
}

export function extractWorkersAiJsonText(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const record = output as Record<string, unknown>;
  if (typeof record.response === "object" && record.response !== null) {
    return JSON.stringify(record.response);
  }
  if (typeof record.response === "string" && record.response.trim()) return unwrapJsonFence(record.response);
  if (typeof record.output_text === "string" && record.output_text.trim()) return unwrapJsonFence(record.output_text);
  const choices = record.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const message = (choices[0] as Record<string, unknown>).message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string" && content.trim()) return unwrapJsonFence(content);
      if (Array.isArray(content)) {
        const text = content
          .map((part) => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
              return String((part as Record<string, unknown>).text);
            }
            return "";
          })
          .join("")
          .trim();
        if (text) return unwrapJsonFence(text);
      }
    }
  }
  // Some GPT-OSS Responses-shaped payloads nest output_text under output[].content[]
  const outputItems = record.output;
  if (Array.isArray(outputItems)) {
    for (const item of outputItems) {
      if (!item || typeof item !== "object") continue;
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const typed = part as Record<string, unknown>;
        if ((typed.type === "output_text" || typed.type === "text") && typeof typed.text === "string" && typed.text.trim()) {
          return unwrapJsonFence(typed.text);
        }
      }
    }
  }
  return undefined;
}

function unwrapJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}
