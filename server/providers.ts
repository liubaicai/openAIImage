import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Model, Options, Provider } from "../shared/types.js";
import { dataDir, db, getTask } from "./store.js";

function privateIP(ip: string): boolean {
  if (ip.includes(":")) {
    const normalized = ip.toLowerCase();
    if (normalized.startsWith("::ffff:")) return true;
    return (
      normalized === "::" ||
      normalized === "::1" ||
      /^(fc|fd|fe[89ab]|ff)/i.test(normalized)
    );
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
export async function validateURL(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search)
    throw new Error("URL 不能包含凭据、查询参数或锚点");
  // Explicit opt-in is reserved for local test fixtures and trusted private gateways.
  if (process.env.ALLOW_PRIVATE_PROVIDERS === "true") return url;
  if (url.protocol !== "https:") throw new Error("接入地址必须使用 HTTPS");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => privateIP(a.address)))
    throw new Error("不允许访问内网地址");
  return url;
}
async function request(
  provider: Provider,
  key: string,
  endpoint: string,
  body: object | FormData,
) {
  await validateURL(provider.baseUrl);
  const multipart = body instanceof FormData;
  const response = await fetch(provider.baseUrl.replace(/\/$/, "") + endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(240_000),
    headers: {
      Authorization: `Bearer ${key}`,
      ...(!multipart ? { "Content-Type": "application/json" } : {}),
    },
    body: multipart ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = `服务商请求失败（${response.status}）`;
    try {
      message +=
        ": " +
        String(JSON.parse(raw).error?.message || "")
          .replaceAll(key, "[REDACTED]")
          .slice(0, 350);
    } catch {
      /* Never echo HTML or credentials. */
    }
    throw new Error(message);
  }
  return response.json();
}

type CatalogEntry = {
  id?: unknown;
  name?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
    modality?: unknown;
  };
  input_modalities?: unknown;
  output_modalities?: unknown;
  modalities?: { input?: unknown; output?: unknown };
};
function modalities(
  raw: CatalogEntry,
  side: "input" | "output",
): string[] | undefined {
  const values = [
    raw.architecture?.[`${side}_modalities`],
    raw[`${side}_modalities`],
    raw.modalities?.[side],
  ];
  for (const value of values)
    if (Array.isArray(value) && value.length)
      return value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.toLowerCase());
  const legacy = raw.architecture?.modality;
  if (typeof legacy === "string" && legacy.includes("->"))
    return legacy
      .split("->")
      [side === "input" ? 0 : 1].split("+")
      .map((v) => v.trim().toLowerCase());
}
async function fetchCatalog(
  baseUrl: string,
  key: string,
  endpoint: string,
  optional = false,
): Promise<CatalogEntry[]> {
  const base = baseUrl.replace(/\/$/, "");
  const initial = new URL(base + endpoint);
  let next: URL | null = initial;
  const visited = new Set<string>();
  const entries: CatalogEntry[] = [];
  while (next) {
    if (visited.has(next.href) || visited.size >= 100)
      throw new Error("模型目录分页异常，请稍后重试");
    // Never forward a credential to another host or arbitrary path supplied in a next link.
    if (
      next.origin !== initial.origin ||
      next.pathname !== initial.pathname ||
      next.username ||
      next.password
    )
      throw new Error("接入商返回了不安全的分页地址");
    visited.add(next.href);
    const response: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (optional && visited.size === 1 && [404, 405].includes(response.status))
      return [];
    if (!response.ok)
      throw new Error(
        `获取模型列表失败（${response.status}，${endpoint}），请检查接入地址与 API Key`,
      );
    const payload: { data?: unknown; links?: { next?: unknown } } =
      await response.json();
    if (!Array.isArray(payload.data))
      throw new Error(`接入商未返回有效的模型列表（${endpoint}）`);
    entries.push(...payload.data);
    const link: unknown = payload.links?.next;
    next = typeof link === "string" && link ? new URL(link, next) : null;
  }
  return entries;
}
export async function listModels(
  baseUrl: string,
  key: string,
  type: Provider["type"] = "openai",
): Promise<Model[]> {
  const url = await validateURL(baseUrl);
  const router = type === "openrouter" || url.hostname === "openrouter.ai";
  const [general, images] = await Promise.all([
    fetchCatalog(baseUrl, key, "/models"),
    router
      ? fetchCatalog(
          baseUrl,
          key,
          "/images/models",
          url.hostname !== "openrouter.ai",
        )
      : Promise.resolve([]),
  ]);
  const models = new Map<string, Model>();
  for (const [entries, dedicated] of [
    [general, false],
    [images, true],
  ] as const) {
    for (const raw of entries) {
      if (
        !raw ||
        typeof raw.id !== "string" ||
        !raw.id.trim() ||
        raw.id.length > 200
      )
        continue;
      // Keep the first complete general record; the dedicated image catalog takes precedence.
      if (!dedicated && models.has(raw.id)) continue;
      const outputs = modalities(raw, "output");
      const inputs = modalities(raw, "input");
      const image =
        dedicated ||
        (outputs
          ? outputs.includes("image")
          : /gpt-image|dall-e|flux|imagen|stable-diffusion|image|ideogram|recraft|seedream|riverflow|nano-banana/i.test(
              raw.id,
            ));
      models.set(raw.id, {
        id: raw.id,
        name: (typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim()
          : raw.id
        ).slice(0, 80),
        kind: image ? "image" : "text",
        canEdit:
          image &&
          (inputs
            ? inputs.includes("image")
            : /gpt-image|dall-e-2/i.test(raw.id)),
        ...(router && image
          ? { imageApi: dedicated ? ("images" as const) : ("chat" as const) }
          : {}),
      });
    }
  }
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}
async function boundedBuffer(response: Response) {
  if (!response.body) throw new Error("图片响应为空");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 30 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("图片超过 30 MB");
    }
    parts.push(chunk.value);
  }
  return Buffer.concat(parts);
}
async function saveImage(userId: string, source: string, taskId: string) {
  if (!getTask(userId, taskId)) throw new Error("任务已删除");
  let bytes: Buffer;
  if (source.startsWith("data:")) {
    const match = source.match(
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/,
    );
    if (!match) throw new Error("服务商返回了不支持的图片格式");
    bytes = Buffer.from(match[2], "base64");
  } else {
    // Signed image URLs may contain a query string; validate the origin/path separately.
    const u = new URL(source);
    const check = new URL(u);
    check.search = "";
    await validateURL(check.toString());
    const response = await fetch(u, {
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error("无法下载服务商返回的图片");
    bytes = await boundedBuffer(response);
  }
  if (bytes.length > 30 * 1024 * 1024) throw new Error("图片超过 30 MB");
  const mime = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216
      ? "image/jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP"
        ? "image/webp"
        : null;
  if (!mime) throw new Error("服务商返回的内容不是 PNG、JPEG 或 WebP 图片");
  const id = randomUUID();
  await writeFile(path.join(dataDir, "images", id), bytes);
  if (!getTask(userId, taskId)) {
    await rm(path.join(dataDir, "images", id), { force: true });
    throw new Error("任务已删除");
  }
  db.prepare(
    "INSERT INTO assets (id,user_id,mime,task_id) VALUES (?,?,?,?)",
  ).run(id, userId, mime, taskId);
  return "/api/images/" + id;
}
export async function generate(
  userId: string,
  provider: Provider,
  key: string,
  model: string,
  prompt: string,
  options: Options,
  sourceImage: string | undefined,
  taskId: string,
) {
  let source: Buffer | undefined;
  let mime = "image/png";
  if (sourceImage) {
    const id = sourceImage.split("/").pop()!;
    const asset = db
      .prepare("SELECT mime FROM assets WHERE id=? AND user_id=?")
      .get(id, userId) as { mime: string } | undefined;
    if (!asset) throw new Error("原始图片不存在");
    mime = asset.mime;
    source = await readFile(path.join(dataDir, "images", id));
  }
  if (provider.type === "openrouter") {
    const configured = provider.models.find((m) => m.id === model);
    let imageApi = configured?.imageApi;
    // Resolve legacy configurations once on use so previously saved models also use the correct API.
    if (!imageApi)
      imageApi = (await listModels(provider.baseUrl, key, "openrouter")).find(
        (m) => m.id === model,
      )?.imageApi;
    if (imageApi === "images") {
      const images: string[] = [];
      // n=1 works for single-image-only providers too. Do not retry a paid request automatically.
      for (let i = 0; i < options.count; i++) {
        const response = await request(provider, key, "/images", {
          model,
          prompt,
          n: 1,
          aspect_ratio:
            options.size === "1536x1024"
              ? "3:2"
              : options.size === "1024x1536"
                ? "2:3"
                : "1:1",
          ...(options.quality !== "auto" ? { quality: options.quality } : {}),
          ...(options.background !== "auto"
            ? { background: options.background }
            : {}),
          ...(source
            ? {
                input_references: [
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${mime};base64,${source.toString("base64")}`,
                    },
                  },
                ],
              }
            : {}),
        });
        if (!Array.isArray(response.data) || !response.data.length)
          throw new Error("模型未返回图片");
        for (const image of response.data) {
          if (!image.b64_json && !image.url)
            throw new Error("服务商返回的图片数据为空");
          images.push(
            await saveImage(
              userId,
              image.b64_json
                ? `data:${image.media_type || "image/png"};base64,${image.b64_json}`
                : image.url,
              taskId,
            ),
          );
        }
      }
      return images;
    }
    const images: string[] = [];
    // Chat image endpoints do not consistently support n; issue one request per requested image.
    for (let i = 0; i < options.count; i++) {
      const content = source
        ? [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mime};base64,${source.toString("base64")}`,
              },
            },
          ]
        : prompt;
      const response = await request(provider, key, "/chat/completions", {
        model,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
        image_config: {
          aspect_ratio:
            options.size === "1536x1024"
              ? "3:2"
              : options.size === "1024x1536"
                ? "2:3"
                : "1:1",
        },
      });
      const output = response.choices?.[0]?.message?.images;
      if (!Array.isArray(output) || !output.length)
        throw new Error("模型未返回图片，请检查模型是否支持图像输出");
      for (const image of output)
        images.push(await saveImage(userId, image.image_url.url, taskId));
    }
    return images;
  }
  const fields = {
    model,
    prompt,
    n: options.count,
    size: options.size,
    ...(options.quality !== "auto" ? { quality: options.quality } : {}),
    ...(options.background !== "auto"
      ? { background: options.background }
      : {}),
  };
  let body: object | FormData = fields;
  if (source) {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
    form.append(
      "image",
      new Blob([new Uint8Array(source)], { type: mime }),
      "source." + mime.split("/")[1],
    );
    body = form;
  }
  const response = await request(
    provider,
    key,
    source ? "/images/edits" : "/images/generations",
    body,
  );
  if (!Array.isArray(response.data) || !response.data.length)
    throw new Error("服务商未返回图片");
  return Promise.all(
    response.data.map((image: { b64_json?: string; url?: string }) => {
      if (!image.b64_json && !image.url)
        throw new Error("服务商返回的图片数据为空");
      return saveImage(
        userId,
        image.b64_json ? `data:image/png;base64,${image.b64_json}` : image.url!,
        taskId,
      );
    }),
  );
}
export async function optimize(
  provider: Provider,
  key: string,
  model: string,
  prompt: string,
) {
  const response = await request(provider, key, "/chat/completions", {
    model,
    messages: [
      {
        role: "system",
        content:
          "你是专业的图像提示词编辑。保留用户原始意图和语言，补充主体、构图、光线、材质和风格细节。不要添加无关元素。仅输出优化后的提示词，不要解释、标题或引号。",
      },
      { role: "user", content: prompt },
    ],
  });
  const value = response.choices?.[0]?.message?.content;
  if (typeof value !== "string" || !value.trim())
    throw new Error("文本模型未返回提示词");
  return value.trim().slice(0, 10000);
}
