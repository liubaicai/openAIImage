import type { Options } from "./types.js";

export type CostEstimate = {
  minUsd: number | null;
  maxUsd: number | null;
  partial: boolean;
  detail: string;
};
export type ImageRate = {
  billable: string;
  unit: string;
  cost_usd: number;
  variant?: string;
};
export type PriceEndpoint = { pricing: ImageRate[] };
export const unknownCost = (
  detail = "暂无明确计费单位的价格，费用待确认",
): CostEstimate => ({ minUsd: null, maxUsd: null, partial: true, detail });
export function costLabel(cost: CostEstimate): string {
  if (cost.minUsd === null || cost.maxUsd === null) return "费用待确认";
  const usd = (v: number) =>
    "$" +
    (v === 0
      ? "0"
      : Number(v.toPrecision(3)).toLocaleString("en-US", {
          maximumFractionDigits: 10,
        }));
  return `约 ${usd(cost.minUsd)}${cost.maxUsd !== cost.minUsd ? "–" + usd(cost.maxUsd) : ""}${cost.partial ? " + 未计费用" : ""}`;
}

// Read only prices with explicit units. The generic catalog's image_output has no reliable unit.
export function estimateImageCost(
  endpoints: PriceEndpoint[],
  options: Options,
  prompt: string,
): CostEstimate {
  const totals: [number, number][] = [];
  let partial = false;
  let heuristic = false;
  let variants = false;
  const [width, height] = options.size.split("x").map(Number);
  const mp = (width * height) / 1e6;
  const ascii = [...prompt].filter((c) => c.charCodeAt(0) < 128).length;
  const textTokens =
    Math.ceil(ascii / 4 + ([...prompt].length - ascii) * 1.5) + 32;
  for (const endpoint of endpoints) {
    if (!Array.isArray(endpoint.pricing)) {
      partial = true;
      continue;
    }
    const valid = (p: ImageRate) =>
      typeof p.cost_usd === "number" &&
      Number.isFinite(p.cost_usd) &&
      p.cost_usd >= 0;
    let outputs = endpoint.pricing.filter((p) => p.billable === "output_image");
    if (!outputs.length || outputs.some((p) => !valid(p))) {
      partial = true;
      continue;
    }
    // Endpoints may normalize requested dimensions. Keep all resolution tiers.
    if (options.quality !== "auto") {
      const matches = outputs.filter(
        (p) => p.variant?.split("/")[0] === options.quality,
      );
      if (matches.length) outputs = matches;
    }
    let inputMin = 0,
      inputMax = 0;
    for (const rate of endpoint.pricing) {
      if (rate.billable === "output_image") continue;
      if (!valid(rate)) {
        partial = true;
        continue;
      }
      if (
        rate.cost_usd === 0 ||
        ["input_image", "input_reference"].includes(rate.billable)
      )
        continue;
      if (
        !rate.variant &&
        rate.unit === "token" &&
        ["input_text", "output_text"].includes(rate.billable)
      ) {
        heuristic = true;
        inputMin +=
          rate.cost_usd *
          (rate.billable === "input_text" ? textTokens * 0.5 : 0);
        inputMax +=
          rate.cost_usd *
          (rate.billable === "input_text" ? textTokens * 2 : 1024);
      } else {
        partial = true;
      }
    }
    for (const rate of outputs) {
      variants ||= !!rate.variant;
      let units: [number, number];
      if (rate.unit === "image" || rate.unit === "request") units = [1, 1];
      else if (rate.unit === "megapixel") {
        units = [Math.min(1, mp), Math.max(1, Math.ceil(mp))];
        heuristic = true;
      } else if (rate.unit === "token") {
        units = [256 * mp, 8192 * mp];
        heuristic = true;
      } else {
        partial = true;
        continue;
      }
      totals.push([
        (rate.cost_usd * units[0] + inputMin) * options.count,
        (rate.cost_usd * units[1] + inputMax) * options.count,
      ]);
    }
  }
  if (!totals.length) return unknownCost();
  return {
    minUsd: Math.min(...totals.map((t) => t[0])),
    maxUsd: Math.max(...totals.map((t) => t[1])),
    partial,
    detail: `USD，${options.count} 张，按每张一次请求计算。${variants ? "包含未确定分辨率或条件档位的价格范围。" : ""}${heuristic ? "用量粗估：像素按所选比例对应尺寸预算；图像按 256–8192 token/百万像素预算，提示词按 ASCII 4 字符/token、其他字符 1.5 token/字并留 32 token，输入用量取 0.5–2 倍，附带文本取 0–1024 token。" : ""}请求包含比例和目标尺寸的文字要求，实际分辨率由模型决定。${partial ? "仅为已知费用小计，存在未计费用。" : ""}路由、实际尺寸及用量可能变化；区间不是费用上限，以 OpenRouter 账单为准。`,
  };
}
