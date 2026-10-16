import type { Options } from "./types.js";

export function aspectRatio(size: Options["size"]): string {
  const [width, height] = size.split("x").map(Number);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

// Apply only to outgoing requests; stored prompts remain the user's original text.
export function generationPrompt(prompt: string, options: Options): string {
  const quality = {
    low: "草稿画质，简化细节，优先呈现主体和构图。",
    medium: "标准画质，保持清晰、自然的细节和干净的边缘。",
    high: "高画质，精细呈现材质、纹理与光影，保持主体清晰、边缘干净。",
  };
  const requirements = [
    `画面比例：${aspectRatio(options.size)}；目标分辨率：${options.size.replace("x", " × ")} 像素（宽 × 高）。请按此比例安排构图，并尽可能按目标尺寸输出。`,
    ...(options.quality === "auto" ? [] : [quality[options.quality]]),
    ...(options.background === "transparent"
      ? ["使用透明背景，保留主体，不添加背景场景。"]
      : options.background === "opaque" ? ["使用不透明背景。"] : []),
    "以上为输出规格，不要将规格说明文字画入图片；保留原提示词的内容与艺术风格。",
  ];
  return `${prompt}\n\n[输出规格]\n${requirements.join("\n")}`;
}
