import type { ArticleAnalysis } from "../domain/types";

export const FEATURE_VERSION = "article-features-v1";
const HASHED_AUTHOR_DIMENSIONS = 6;
const HASHED_THEME_DIMENSIONS = 6;

export interface ArticleFeatureInput {
  author: string;
  wordCount: number;
  analysis: ArticleAnalysis;
  projection: number[];
}

export function articleFeatures(input: ArticleFeatureInput): number[] {
  return [
    1,
    input.analysis.intrinsicScore / 10,
    input.analysis.scores.longTermValue / 10,
    input.analysis.scores.ideaDensity / 10,
    input.analysis.scores.argumentQuality / 10,
    input.analysis.scores.originality / 10,
    input.analysis.scores.clarityStructure / 10,
    Math.min(1.5, Math.log1p(input.wordCount) / 10),
    ...input.projection,
    ...hashedCategory(input.author, HASHED_AUTHOR_DIMENSIONS),
    ...hashedCategory(input.analysis.primaryTheme, HASHED_THEME_DIMENSIONS),
  ];
}

function hashedCategory(value: string, dimensions: number): number[] {
  const result = Array.from({ length: dimensions }, () => 0);
  const hash = fnv1a(value.toLowerCase());
  result[hash % dimensions] = (hash & 0x80000000) === 0 ? 1 : -1;
  return result;
}
function fnv1a(value: string): number { let hash = 0x811c9dc5; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); } return hash >>> 0; }
