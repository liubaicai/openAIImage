import { createHash } from "node:crypto";
import type { Provider, Options } from "../shared/types.js";
import {
  estimateImageCost,
  unknownCost,
  type PriceEndpoint,
} from "../shared/pricing.js";
import { validateURL } from "./providers.js";

const cache = new Map<
  string,
  { expires: number; value: Promise<PriceEndpoint[]> }
>();
export async function estimateProviderCost(
  provider: Provider,
  key: string,
  modelId: string,
  options: Options,
  prompt: string,
) {
  if (
    provider.type !== "openrouter" &&
    new URL(provider.baseUrl).hostname !== "openrouter.ai"
  )
    return unknownCost("此接入商暂不支持价格预估");
  const url =
    provider.baseUrl.replace(/\/$/, "") +
    "/images/models/" +
    modelId.split("/").map(encodeURIComponent).join("/") +
    "/endpoints";
  const cacheKey = url + createHash("sha256").update(key).digest("hex");
  try {
    let entry = cache.get(cacheKey);
    if (!entry || entry.expires < Date.now()) {
      if (cache.size > 200) cache.clear();
      const value = (async () => {
        await validateURL(provider.baseUrl);
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) throw new Error("Pricing unavailable");
        const body = await response.json();
        if (!Array.isArray(body.endpoints)) throw new Error("Invalid pricing");
        return body.endpoints as PriceEndpoint[];
      })();
      entry = { value, expires: Date.now() + 5 * 60_000 };
      cache.set(cacheKey, entry);
    }
    return estimateImageCost(await entry.value, options, prompt);
  } catch {
    cache.delete(cacheKey);
    return unknownCost(
      "价格明细暂不可用或模型未提供图像端点价格；可继续生成，实际费用以账单为准",
    );
  }
}
