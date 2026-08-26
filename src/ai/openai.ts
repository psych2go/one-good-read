import { weightedIntrinsicScore } from "../domain/scoring";
import type { ArticleAnalysis, ExtractedArticle, PublicRecommendationCopy, RankedCandidate } from "../domain/types";
import type { AiProvider, AnalysisContext } from "./provider";

const THEMES = ["工作与创造","创业与商业","投资与资本配置","风险与不确定性","决策与判断","心理与行为","科技与产业","AI 与软件","经济与制度","社会与文化","学习与知识","人生与长期主义","估值与金融技术","科学与认识论"];

export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  constructor(readonly model: string, private readonly apiKey: string) {}

  async analyze(article: ExtractedArticle, context: AnalysisContext): Promise<ArticleAnalysis> {
    const blind = await this.callJson<BlindResult>(
      "article_blind_analysis",
      blindSchema,
      "你是严谨的文章编辑。只根据正文盲评，不根据作者声誉。分数使用0到10。必须阅读全文，区分长期价值、思想密度、论证质量、原创性、表达结构。",
      `正文：\n${article.text}`,
    );
    const contextual = await this.callJson<ContextResult>(
      "article_context_analysis",
      contextSchema,
      `你是长期阅读策展编辑。结合作者、发布日期和盲评结果进行主题与上下文判断。规范主题只能从给定列表中选择：${THEMES.join("、")}。不得因为作者知名度提高内在质量分。`,
      JSON.stringify({ title: article.title, author: article.author, publishedAt: article.publishedAt, url: article.canonicalUrl, blind }),
    );
    const scores = {
      longTermValue: blind.longTermValue,
      ideaDensity: blind.ideaDensity,
      argumentQuality: blind.argumentQuality,
      originality: blind.originality,
      clarityStructure: blind.clarityStructure,
    };
    return {
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
    const result = await this.callJson<{ articleId: string; rationale: string }>("daily_editor_choice", {
      type: "object", additionalProperties: false, required: ["articleId","rationale"], properties: { articleId: { type: "string" }, rationale: { type: "string" } },
    }, "你是克制的每日阅读编辑。只能从给定Top候选中选择一篇。质量优先，尊重作者与主题疲劳、探索和新文信号。不得选择列表外文章。", JSON.stringify({ recentSummary, candidates: candidates.map(minimalCandidate) }));
    if (!candidates.some((candidate) => candidate.articleId === result.articleId)) throw new Error("AI selected an article outside Top candidates");
    return result;
  }

  async writeRecommendation(winner: RankedCandidate, recentSummary: string): Promise<PublicRecommendationCopy> {
    return this.callJson<PublicRecommendationCopy>("public_recommendation_copy", {
      type: "object", additionalProperties: false, required: ["whyWorthReading","whyToday","keywords"], properties: {
        whyWorthReading: { type: "string", minLength: 40, maxLength: 240 },
        whyToday: { type: "string", minLength: 30, maxLength: 200 },
        keywords: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
      },
    }, "用简体中文写克制的推荐说明。不要总结全文，不提前讲完结论，不虚构用户状态，不把推荐写成事实背书。为什么值得读60-120字；为什么今天40-100字。", JSON.stringify({ recentSummary, winner: minimalCandidate(winner) }));
  }

  private async callJson<T>(name: string, schema: Record<string, unknown>, system: string, input: string): Promise<T> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        input: [{ role: "system", content: [{ type: "input_text", text: system }] }, { role: "user", content: [{ type: "input_text", text: input }] }],
        text: { format: { type: "json_schema", name, strict: true, schema } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI response failed: ${response.status} ${await response.text()}`);
    const payload = await response.json<{ output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }>();
    const outputText = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("OpenAI response did not contain output_text");
    return JSON.parse(outputText) as T;
  }
}

interface BlindResult { longTermValue: number; ideaDensity: number; argumentQuality: number; originality: number; clarityStructure: number; confidence: number; evidence: string[]; riskNotes: string[]; }
interface ContextResult { primaryTheme: string; secondaryThemes: string[]; keywords: string[]; confidence: number; contextSummary: string; }

const score = { type: "number", minimum: 0, maximum: 10 };
const blindSchema = { type: "object", additionalProperties: false, required: ["longTermValue","ideaDensity","argumentQuality","originality","clarityStructure","confidence","evidence","riskNotes"], properties: { longTermValue: score, ideaDensity: score, argumentQuality: score, originality: score, clarityStructure: score, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } }, riskNotes: { type: "array", maxItems: 5, items: { type: "string" } } } };
const contextSchema = { type: "object", additionalProperties: false, required: ["primaryTheme","secondaryThemes","keywords","confidence","contextSummary"], properties: { primaryTheme: { type: "string", enum: THEMES }, secondaryThemes: { type: "array", maxItems: 3, items: { type: "string", enum: THEMES } }, keywords: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } }, confidence: { type: "number", minimum: 0, maximum: 1 }, contextSummary: { type: "string" } } };
function minimalCandidate(candidate: RankedCandidate) { return { articleId: candidate.articleId, title: candidate.title, author: candidate.author, publishedAt: candidate.publishedAt, readingMinutes: candidate.readingMinutes, intrinsicScore: candidate.analysis.intrinsicScore, scores: candidate.analysis.scores, primaryTheme: candidate.analysis.primaryTheme, secondaryThemes: candidate.analysis.secondaryThemes, evidence: candidate.analysis.evidence, riskNotes: candidate.analysis.riskNotes, dynamicScore: candidate.dynamicScore, scoreExplanation: candidate.explanation }; }
