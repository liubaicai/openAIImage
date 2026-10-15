import "node:process";
import express from "express";
import { z } from "zod";
import {
  randomUUID,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import {
  db,
  dataDir,
  encrypt,
  getSettings,
  saveSettings,
  getTask,
  saveTask,
  getSecret,
} from "./store.js";
import { optimize, validateURL, listModels } from "./providers.js";
import { startWorker } from "./worker.js";
import { estimateProviderCost } from "./pricing.js";
import type { User, Task, Result } from "../shared/types.js";

const hashPassword = promisify(scrypt);
const app = express();
app.disable("x-powered-by");
app.use("/api/providers", express.json({ limit: "10mb" }));
app.use(express.json({ limit: "128kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host)
        return res.status(403).json({ error: "请求来源不匹配" });
    } catch {
      return res.status(403).json({ error: "无效请求来源" });
    }
  }
  next();
});
const fail = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });
const tokenOf = (req: express.Request) =>
  req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("frame_session="))
    ?.slice(14) || "";
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function session(req: express.Request): User | undefined {
  return db
    .prepare(
      "SELECT u.id,a.username AS name,a.username FROM users u JOIN admin a ON a.user_id=u.id JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
    )
    .get(tokenHash(tokenOf(req)), Date.now()) as User | undefined;
}
function setSession(res: express.Response, userId: string) {
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
    tokenHash(token),
    userId,
    Date.now() + 7 * 86400000,
  );
  res.cookie("frame_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.SECURE_COOKIES === "true",
    maxAge: 7 * 86400000,
    path: "/",
  });
}
const attempts = new Map<string, { count: number; until: number }>();
app.use("/api/auth", (req, res, next) => {
  if (req.method !== "POST") return next();
  const key = req.ip || "local";
  const now = Date.now();
  const old = attempts.get(key);
  const entry =
    old && old.until > now ? old : { count: 0, until: now + 60_000 };
  entry.count++;
  attempts.set(key, entry);
  if (attempts.size > 10000)
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  if (entry.count > 15)
    return res.status(429).json({ error: "尝试过于频繁，请一分钟后重试" });
  next();
});
const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(1, "请输入用户名")
    .max(40)
    .regex(/^[a-zA-Z0-9_.-]+$/, "用户名仅支持字母、数字、下划线、点和短横线"),
  password: z.string().min(10, "密码至少需要 10 位").max(128),
});
const hasAdmin = () =>
  !!db.prepare("SELECT 1 FROM admin WHERE singleton=1").get();
app.get("/api/auth/me", (req, res) =>
  res.json({ user: session(req) || null, setupRequired: !hasAdmin() }),
);
app.post("/api/auth/setup", async (req, res) => {
  if (hasAdmin()) throw fail("管理员已设置，请直接登录", 409);
  const body = credentials
    .extend({ confirmPassword: z.string() })
    .refine((v) => v.password === v.confirmPassword, "两次密码不一致")
    .parse(req.body);
  const salt = randomBytes(16).toString("hex");
  const derived = (await hashPassword(body.password, salt, 64)) as Buffer;
  const user = {
    id: randomUUID(),
    name: body.username,
    username: body.username,
  };
  // Recheck after async hashing, inside a transaction: simultaneous setup can create only one admin.
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasAdmin()) throw fail("管理员已设置，请直接登录", 409);
    db.prepare("INSERT INTO users VALUES (?,?,?,?)").run(
      user.id,
      "admin@local.invalid",
      user.name,
      `${salt}:${derived.toString("hex")}`,
    );
    db.prepare("INSERT INTO admin VALUES (1,?,?)").run(user.id, user.username);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  setSession(res, user.id);
  res.status(201).json({ user });
});
app.post("/api/auth/login", async (req, res) => {
  if (!hasAdmin()) throw fail("请先设置管理员账户", 409);
  const body = credentials.parse(req.body);
  const row = db
    .prepare(
      "SELECT u.id,a.username,u.password FROM users u JOIN admin a ON a.user_id=u.id WHERE a.username=?",
    )
    .get(body.username) as
    { id: string; username: string; password: string } | undefined;
  const [salt, stored] = row?.password.split(":") || [
    "00000000000000000000000000000000",
    "00".repeat(64),
  ];
  const derived = (await hashPassword(body.password, salt, 64)) as Buffer;
  if (!timingSafeEqual(derived, Buffer.from(stored, "hex")) || !row)
    throw fail("用户名或密码不正确", 401);
  setSession(res, row.id);
  res.json({
    user: { id: row.id, username: row.username, name: row.username },
  });
});
// Registration is intentionally unavailable, even to the administrator.
app.post("/api/auth/register", (_req, res) =>
  res.status(404).json({ error: "仅支持单管理员账户，不提供注册" }),
);
app.post("/api/auth/logout", (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token=?").run(tokenHash(tokenOf(req)));
  res.clearCookie("frame_session", { path: "/" });
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  const user = session(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  res.locals.user = user;
  next();
});
app.get("/api/settings", (_req, res) =>
  res.json(getSettings(res.locals.user.id)),
);
const modelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["image", "text"]),
  canEdit: z.boolean(),
  imageApi: z.enum(["images", "chat"]).optional(),
});
const providerSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    type: z.enum(["openai", "openrouter"]),
    baseUrl: z.string().url().max(500),
    apiKey: z.string().trim().max(1000).optional(),
    models: z.array(modelSchema),
    refreshModels: z.boolean().optional(),
  })
  .refine(
    (v) => new Set(v.models.map((m) => m.id)).size === v.models.length,
    "模型 ID 不能重复",
  );
const connectionSchema = z.object({
  type: z.enum(["openai", "openrouter"]).optional(),
  providerId: z.string().uuid().optional(),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().trim().max(1000).optional(),
});
app.post("/api/providers/models", async (req, res) => {
  const body = connectionSchema.parse(req.body);
  const existing = getSettings(res.locals.user.id).providers.find(
    (p) => p.id === body.providerId,
  );
  if (
    !body.apiKey &&
    (!existing || existing.baseUrl !== body.baseUrl.replace(/\/$/, ""))
  )
    throw fail("请输入此接入地址的 API Key");
  const key = body.apiKey || getSecret(res.locals.user.id, existing!.id);
  try {
    res.json({
      models: await listModels(body.baseUrl, key, body.type || existing?.type),
    });
  } catch (e) {
    throw fail(e instanceof Error ? e.message : "获取模型列表失败", 400);
  }
});
async function saveProvider(req: express.Request, res: express.Response) {
  const userId = res.locals.user.id;
  const id = req.params.id
    ? z.string().uuid().parse(req.params.id)
    : randomUUID();
  const body = providerSchema.parse(req.body);
  const settings = getSettings(userId);
  const existing = settings.providers.find((p) => p.id === id);
  const reuseModels =
    existing &&
    existing.baseUrl === body.baseUrl.replace(/\/$/, "") &&
    existing.type === body.type &&
    !body.refreshModels &&
    body.models.every((m) =>
      existing.models.some((saved) => saved.id === m.id),
    );
  if (!reuseModels) await validateURL(body.baseUrl);
  if (!existing && settings.providers.length >= 20)
    throw fail("最多配置 20 个接入商");
  if (
    !body.apiKey &&
    (!existing?.hasKey || existing.baseUrl !== body.baseUrl.replace(/\/$/, ""))
  )
    throw fail("请输入此接入地址的 API Key");
  let catalog;
  try {
    catalog = reuseModels
      ? existing.models
      : await listModels(
          body.baseUrl,
          body.apiKey || getSecret(userId, id),
          body.type,
        );
  } catch (e) {
    throw fail(e instanceof Error ? e.message : "获取模型列表失败");
  }
  if (body.models.some((m) => !catalog.some((item) => item.id === m.id)))
    throw fail("部分模型已不在接入商列表中，请重新获取后选择");
  const { apiKey, refreshModels: _refreshModels, ...data } = body;
  if (apiKey)
    db.prepare(
      "INSERT INTO secrets VALUES (?,?,?) ON CONFLICT(user_id,provider_id) DO UPDATE SET value=excluded.value",
    ).run(userId, id, encrypt(apiKey));
  const provider = {
    ...data,
    models: data.models.map((m) => ({
      ...m,
      imageApi: catalog.find((c) => c.id === m.id)?.imageApi,
    })),
    id,
    baseUrl: body.baseUrl.replace(/\/$/, ""),
    hasKey: true,
  };
  settings.providers = [
    ...settings.providers.filter((p) => p.id !== id),
    provider,
  ];
  if (
    settings.textModel?.providerId === id &&
    !provider.models.some(
      (m) => m.id === settings.textModel?.modelId && m.kind === "text",
    )
  )
    settings.textModel = null;
  if (
    settings.defaultImageModel?.providerId === id &&
    !provider.models.some(
      (m) => m.id === settings.defaultImageModel?.modelId && m.kind === "image",
    )
  )
    settings.defaultImageModel = null;
  saveSettings(userId, settings);
  res.json(settings);
}
app.post("/api/providers", saveProvider);
app.put("/api/providers/:id", saveProvider);
app.delete("/api/providers/:id", (req, res) => {
  const userId = res.locals.user.id;
  const settings = getSettings(userId);
  const busy = (
    db.prepare("SELECT data FROM tasks WHERE user_id=?").all(userId) as {
      data: string;
    }[]
  ).some((row) =>
    (JSON.parse(row.data) as Task).results.some(
      (r) =>
        r.providerId === req.params.id &&
        ["queued", "running"].includes(r.status),
    ),
  );
  if (busy) throw fail("该接入商还有未完成的任务");
  settings.providers = settings.providers.filter((p) => p.id !== req.params.id);
  if (settings.textModel?.providerId === req.params.id)
    settings.textModel = null;
  if (settings.defaultImageModel?.providerId === req.params.id)
    settings.defaultImageModel = null;
  saveSettings(userId, settings);
  db.prepare("DELETE FROM secrets WHERE user_id=? AND provider_id=?").run(
    userId,
    req.params.id,
  );
  res.json(settings);
});
app.put("/api/settings/default-image-model", (req, res) => {
  const settings = getSettings(res.locals.user.id);
  const choice = z
    .object({ providerId: z.string(), modelId: z.string() })
    .nullable()
    .parse(req.body);
  if (
    choice &&
    !settings.providers.some(
      (p) =>
        p.id === choice.providerId &&
        p.models.some((m) => m.id === choice.modelId && m.kind === "image"),
    )
  )
    throw fail("图像模型不存在");
  settings.defaultImageModel = choice;
  saveSettings(res.locals.user.id, settings);
  res.json(settings);
});
app.put("/api/settings/text-model", (req, res) => {
  const settings = getSettings(res.locals.user.id);
  const choice = z
    .object({ providerId: z.string(), modelId: z.string() })
    .nullable()
    .parse(req.body);
  if (
    choice &&
    !settings.providers.some(
      (p) =>
        p.id === choice.providerId &&
        p.models.some((m) => m.id === choice.modelId && m.kind === "text"),
    )
  )
    throw fail("文本模型不存在");
  settings.textModel = choice;
  saveSettings(res.locals.user.id, settings);
  res.json(settings);
});
app.post("/api/optimize", async (req, res) => {
  const { prompt } = z
    .object({ prompt: z.string().trim().min(1).max(10000) })
    .parse(req.body);
  const settings = getSettings(res.locals.user.id);
  const choice = settings.textModel;
  if (!choice) throw fail("请先选择一个文本模型");
  const provider = settings.providers.find((p) => p.id === choice.providerId)!;
  res.json({
    prompt: await optimize(
      provider,
      getSecret(res.locals.user.id, provider.id),
      choice.modelId,
      prompt,
    ),
  });
});
const optionsSchema = z.object({
  size: z.enum(["1024x1024", "1536x1024", "1024x1536"]),
  quality: z.enum(["auto", "low", "medium", "high"]),
  count: z.number().int().min(1).max(4),
  background: z.enum(["auto", "opaque", "transparent"]),
});
app.post("/api/estimates", async (req, res) => {
  const body = z
    .object({
      models: z
        .array(z.object({ providerId: z.string(), modelId: z.string() }))
        .max(10),
      options: optionsSchema,
      prompt: z.string().max(10000),
    })
    .parse(req.body);
  const userId = res.locals.user.id;
  const settings = getSettings(userId);
  const choices = body.models.map((choice) => {
    const provider = settings.providers.find((p) => p.id === choice.providerId);
    if (
      !provider?.models.some(
        (m) => m.id === choice.modelId && m.kind === "image",
      )
    )
      throw fail("生成模型不存在");
    return { ...choice, provider };
  });
  res.json(
    await Promise.all(
      choices.map(async ({ provider, providerId, modelId }) => ({
        id: providerId + "|" + modelId,
        cost: await estimateProviderCost(
          provider,
          getSecret(userId, providerId),
          modelId,
          body.options,
          body.prompt,
        ),
      })),
    ),
  );
});
app.get("/api/tasks", (_req, res) => {
  const rows = db
    .prepare("SELECT data FROM tasks WHERE user_id=? ORDER BY rowid DESC")
    .all(res.locals.user.id) as { data: string }[];
  res.json(rows.map((row) => JSON.parse(row.data)));
});
function requireTask(res: express.Response, id: string) {
  const t = getTask(res.locals.user.id, id);
  if (!t) throw fail("任务不存在", 404);
  return t;
}
function checkQueue(userId: string) {
  const pending = (
    db.prepare("SELECT data FROM tasks WHERE user_id=?").all(userId) as {
      data: string;
    }[]
  ).reduce(
    (n, row) =>
      n +
      (JSON.parse(row.data) as Task).results.filter((r) =>
        ["queued", "running"].includes(r.status),
      ).length,
    0,
  );
  if (pending >= 24) throw fail("未完成任务较多，请等待部分任务完成", 429);
}
app.post("/api/tasks", (req, res) => {
  const body = z
    .object({
      title: z.string().trim().max(80).optional(),
      prompt: z.string().trim().min(1).max(10000),
      models: z
        .array(z.object({ providerId: z.string(), modelId: z.string() }))
        .min(1)
        .max(10),
      options: optionsSchema,
    })
    .parse(req.body);
  const userId = res.locals.user.id;
  checkQueue(userId);
  const settings = getSettings(userId);
  if (
    new Set(body.models.map((m) => m.providerId + ":" + m.modelId)).size !==
    body.models.length
  )
    throw fail("不能重复选择相同模型");
  const results: Result[] = body.models.map((choice) => {
    const p = settings.providers.find((p) => p.id === choice.providerId);
    const m = p?.models.find(
      (m) => m.id === choice.modelId && m.kind === "image",
    );
    if (!p || !m || !p.hasKey) throw fail("所选模型不可用");
    return {
      id: randomUUID(),
      providerId: p.id,
      providerName: p.name,
      modelId: m.id,
      modelName: m.name,
      canEdit: m.canEdit,
      status: "queued",
      images: [],
      createdAt: new Date().toISOString(),
    };
  });
  const task: Task = {
    id: randomUUID(),
    title: body.title || body.prompt.slice(0, 32),
    prompt: body.prompt,
    options: body.options,
    createdAt: new Date().toISOString(),
    favoriteImages: [],
    results,
  };
  saveTask(userId, task);
  res.status(201).json(task);
});
app.patch("/api/tasks/:id/favorites", (req, res) => {
  const task = requireTask(res, req.params.id);
  const body = z
    .object({ image: z.string(), favorite: z.boolean() })
    .parse(req.body);
  if (!task.results.some((r) => r.images.includes(body.image)))
    throw fail("图片不属于此任务", 404);
  const favorites = new Set(task.favoriteImages || []);
  if (body.favorite) favorites.add(body.image);
  else favorites.delete(body.image);
  task.favoriteImages = [...favorites];
  saveTask(res.locals.user.id, task);
  res.json(task);
});
app.delete("/api/tasks/:id", (req, res) => {
  const task = requireTask(res, req.params.id);
  const userId = res.locals.user.id;
  const assets = db
    .prepare("SELECT id FROM assets WHERE user_id=? AND task_id=?")
    .all(userId, task.id) as { id: string }[];
  // Synchronous cleanup prevents worker completion from interleaving with deletion.
  for (const asset of assets) {
    if (!/^[a-f0-9-]{36}$/i.test(asset.id)) throw new Error("Invalid asset ID");
    rmSync(path.join(dataDir, "images", asset.id), { force: true });
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM assets WHERE user_id=? AND task_id=?").run(
      userId,
      task.id,
    );
    db.prepare("DELETE FROM tasks WHERE user_id=? AND id=?").run(
      userId,
      task.id,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ deleted: true });
});
app.post("/api/tasks/:id/edit", (req, res) => {
  const task = requireTask(res, req.params.id);
  checkQueue(res.locals.user.id);
  const body = z
    .object({
      resultId: z.string(),
      image: z.string(),
      changes: z.string().trim().min(1).max(10000),
    })
    .parse(req.body);
  const parent = task.results.find((r) => r.id === body.resultId);
  if (
    !parent?.canEdit ||
    parent.status !== "completed" ||
    !parent.images.includes(body.image)
  )
    throw fail("此图片不能编辑");
  const current = getSettings(res.locals.user.id)
    .providers.find((p) => p.id === parent.providerId)
    ?.models.find((m) => m.id === parent.modelId);
  if (!current?.canEdit) throw fail("请先恢复该模型的图片编辑配置");
  task.results.push({
    ...parent,
    id: randomUUID(),
    status: "queued",
    images: [],
    error: undefined,
    elapsed: undefined,
    parentId: parent.id,
    sourceImage: body.image,
    changes: body.changes,
    createdAt: new Date().toISOString(),
  });
  saveTask(res.locals.user.id, task);
  res.status(201).json(task);
});
app.post("/api/tasks/:id/retry/:resultId", (req, res) => {
  const task = requireTask(res, req.params.id);
  checkQueue(res.locals.user.id);
  const result = task.results.find((r) => r.id === req.params.resultId);
  if (!result || result.status !== "failed") throw fail("仅失败结果可以重试");
  result.status = "queued";
  result.error = undefined;
  saveTask(res.locals.user.id, task);
  res.json(task);
});
app.get("/api/images/:id", (req, res) => {
  const asset = db
    .prepare("SELECT mime FROM assets WHERE id=? AND user_id=?")
    .get(req.params.id, res.locals.user.id) as { mime: string } | undefined;
  if (!asset) throw fail("图片不存在", 404);
  res.type(asset.mime).sendFile(path.join(dataDir, "images", req.params.id));
});
app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
if (existsSync(path.resolve("dist"))) {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
}
app.use(
  (
    error: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: error.issues[0]?.message || "输入不正确" });
    const status = error.status || 500;
    res.status(status).json({
      error:
        status < 500 ? error.message : "请求处理失败，请检查接入配置或稍后重试",
    });
    if (status >= 500) console.error("[API]", error.name);
  },
);
startWorker();
const port = Number(process.env.PORT) || 3001;
app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`Yingtai API: http://${process.env.HOST || "127.0.0.1"}:${port}`),
);
