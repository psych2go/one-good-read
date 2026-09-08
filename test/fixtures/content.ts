import type { ContentEligibility, ExtractedArticle } from "../../src/domain/types";

// Representative public-page text supplied by the audit; not claimed byte-identical to private R2.
export const abstractText = "I study how short-form design amplifies self-control problems in digital media. Short units repeatedly renew temptation that lasts longer than each unit, turning local temptation into sustained overconsumption. Using microdata from a U.S. short-drama platform, I exploit a nonlinear top-up menu to infer viewing plans and show that paying users watch 82.1% more than intended. Structural estimates imply an average temptation horizon of 11.2 minutes, short relative to the full drama but long relative to one-minute episodes. Counterfactuals show that larger decision units, default limits, and breaks improve long-run welfare. A short-video calibration highlights the broader welfare relevance. That is from Renjie Bao of Princeton University. I believe a Princeton job market candidate? Via Quan Le.";
export const abstractRisk = "提供的正文主要是摘要，缺少数据构造、识别假设、模型设定、稳健性检验和福利函数细节，因此对论证质量的评价置信度有限。";
export const abstractArticle: ExtractedArticle = {
  sourceId: "marginal-revolution", canonicalUrl: "https://marginalrevolution.com/marginalrevolution/2026/09/short-videos-big-self-control-problems.html",
  title: "Short Videos, Big Self-Control Problems", author: "Tyler Cowen", text: abstractText, contentHash: "abstract", wordCount: 131,
  readingMinutes: 1, extractionConfidence: .9, externalLinkCount: 2,
};
export const shortEssay = "Keep a decision journal before you know the outcome. A good outcome can follow a careless decision, and a bad outcome can follow a careful one. If you record only results, luck will impersonate skill. Write the alternatives, the uncertainty, and the reason for choosing now. Later, compare those expectations with events. This separates what you could have known from what hindsight makes obvious.";
export const quoteHeavyEssay = `“Keep a decision journal before you know the outcome. A good outcome can follow a careless decision, and a bad outcome can follow a careful one. If you record only results, luck will impersonate skill. Write the alternatives, the uncertainty, and the reason for choosing now. Later, compare those expectations with events. This separates what you could have known from what hindsight makes obvious.”
This advice has a limit: journaling can reward elaborate rationalization. My remedy is to record a prediction that could fail, not just a reason that sounds wise. Test one forecast against its outcome before adding more paperwork. The journal then becomes an experiment rather than a defense brief.`;
export function standalone(body = shortEssay): ContentEligibility {
  return { version: "standalone-v1", format: "standalone_essay", reason: "The body develops its own claim, reason, and practical limit.", bodyEvidence: [body.slice(0, 90)] };
}
