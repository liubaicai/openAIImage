import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultOptions, taskStatus, type Task } from "../shared/types.js";

const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2l9sAAAAASUVORK5CYII=";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
test(
  "single admin initialization, model discovery and generation lifecycle",
  { timeout: 45000 },
  async () => {
    const requests: { url: string; body: string; contentType: string }[] = [];
    let failModel = true;
    let releaseGeneration: (() => void) | undefined;
    const upstream = createServer(async (req, res) => {
      let body = "";
      for await (const part of req) body += part;
      requests.push({
        url: req.url!,
        body,
        contentType: req.headers["content-type"] || "",
      });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/images/models/router-model/endpoints") {
        assert.equal(
          req.headers.authorization,
          "Bearer secret-fixture-key-not-for-browser",
        );
        res.end(
          JSON.stringify({
            endpoints: [
              {
                pricing: [
                  { billable: "output_image", unit: "image", cost_usd: 0.04 },
                ],
              },
            ],
          }),
        );
        return;
      }
      if (req.url?.split("?")[0].endsWith("/models")) {
        if (
          req.headers.authorization !==
          "Bearer secret-fixture-key-not-for-browser"
        ) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: { message: "unauthorized" } }));
          return;
        }
        if (req.url === "/v1/images/models") {
          res.end(
            JSON.stringify({
              data: [
                {
                  id: "router-model",
                  name: "Router native",
                  architecture: {
                    input_modalities: ["image", "text"],
                    output_modalities: ["image"],
                  },
                },
                {
                  id: "bytedance-seed/seedream-fixture",
                  name: "Seedream",
                  architecture: {
                    input_modalities: ["image", "text"],
                    output_modalities: ["image"],
                  },
                },
              ],
            }),
          );
          return;
        }
        if (req.url === "/paged/images/models") {
          res.statusCode = 404;
          res.end("{}");
          return;
        }
        if (req.url === "/paged/models") {
          res.end(
            JSON.stringify({
              data: [{ id: "first" }],
              links: { next: "?page=2" },
            }),
          );
          return;
        }
        if (req.url === "/paged/models?page=2") {
          res.end(
            JSON.stringify({ data: [{ id: "second" }], links: { next: null } }),
          );
          return;
        }
        if (req.url === "/unsafe/models") {
          res.end(
            JSON.stringify({
              data: [],
              links: { next: "https://example.com/models" },
            }),
          );
          return;
        }
        if (req.url === "/unavailable/images/models") {
          res.statusCode = 503;
          res.end("{}");
          return;
        }
        if (req.url === "/empty/models") {
          res.end(JSON.stringify({ data: [] }));
          return;
        }
        if (req.url === "/invalid/models") {
          res.end(JSON.stringify({ message: "not a catalog" }));
          return;
        }
        res.end(
          JSON.stringify({
            data: [
              {
                id: "image-model",
                name: "Image",
                architecture: {
                  output_modalities: ["image"],
                  input_modalities: ["image", "text"],
                },
              },
              {
                id: "broken-model",
                name: "Broken",
                architecture: {
                  output_modalities: ["image"],
                  input_modalities: ["text"],
                },
              },
              {
                id: "router-model",
                name: "Router",
                architecture: {
                  output_modalities: ["image"],
                  input_modalities: ["image", "text"],
                },
              },
              {
                id: "text-model",
                name: "Text",
                architecture: {
                  output_modalities: ["text"],
                  input_modalities: ["text"],
                },
              },
              { id: "gpt-image-1" },
              { id: "text-model" },
              { id: null },
              {
                id: "vision-only",
                architecture: {
                  input_modalities: ["image", "text"],
                  output_modalities: ["text"],
                },
              },
              {
                id: "legacy-modality",
                architecture: { modality: "text+image->image" },
              },
              {
                id: "models-dev-format",
                modalities: { input: ["text"], output: ["image"] },
              },
              ...Array.from({ length: 40 }, (_, i) => ({
                id: `extra-model-${i}`,
              })),
            ],
          }),
        );
        return;
      }
      if (body.includes("broken-model") && failModel) {
        res.statusCode = 429;
        res.end(
          JSON.stringify({
            error: { message: "test provider quota exceeded" },
          }),
        );
        return;
      }
      if (
        req.url === "/v1/images/generations" &&
        JSON.parse(body).prompt.startsWith("delete in flight\n")
      ) {
        await new Promise<void>((resolve) => {
          releaseGeneration = resolve;
        });
      }
      if (req.url === "/v1/chat/completions") {
        const parsed = JSON.parse(body);
        res.end(
          JSON.stringify({
            choices: [
              {
                message: parsed.modalities
                  ? {
                      images: [
                        {
                          image_url: { url: "data:image/png;base64," + pixel },
                        },
                      ],
                    }
                  : { content: "优化后的自然光静物摄影提示词" },
              },
            ],
          }),
        );
      } else res.end(JSON.stringify({ data: [{ b64_json: pixel }] }));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const upstreamPort = (upstream.address() as { port: number }).port;
    const reserve = createServer();
    await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((r) => reserve.close(() => r()));
    const directory = await mkdtemp(path.join(tmpdir(), "frame-test-"));
    let child: ChildProcess | undefined;
    let logs = "";
    const base = `http://127.0.0.1:${port}`;
    const start = async () => {
      child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
        env: {
          ...process.env,
          DATA_DIR: directory,
          PORT: String(port),
          ALLOW_PRIVATE_PROVIDERS: "true",
          SECURE_COOKIES: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (d) => {
        logs += d;
      });
      child.stderr?.on("data", (d) => {
        logs += d;
      });
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch(base + "/api/auth/me")).ok) return;
        } catch {}
        await sleep(100);
      }
      throw new Error("Server failed: " + logs);
    };
    const stop = async () => {
      if (child && child.exitCode === null) {
        const exited = new Promise<void>((r) => child!.once("exit", () => r()));
        child.kill();
        await exited;
      }
    };
    const call = async (
      route: string,
      method = "GET",
      body?: unknown,
      cookie = "",
    ) => {
      const response = await fetch(base + "/api" + route, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          Cookie: cookie,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : await response.arrayBuffer();
      return {
        status: response.status,
        data,
        cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
      };
    };
    try {
      await start();
      assert.equal((await call("/tasks")).status, 401);
      assert.equal((await call("/auth/me")).data.setupRequired, true);
      assert.equal(
        (
          await call("/auth/setup", "POST", {
            username: "owner",
            password: "very-strong-test-password",
            confirmPassword: "different",
          })
        ).status,
        400,
      );
      const attempts = await Promise.all(
        [1, 2].map(() =>
          call("/auth/setup", "POST", {
            username: "owner",
            password: "very-strong-test-password",
            confirmPassword: "very-strong-test-password",
          }),
        ),
      );
      assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
      const account = attempts.find((r) => r.status === 201)!;
      const cookie = account.cookie;
      assert.ok(cookie.startsWith("frame_session="));
      const state = (await call("/auth/me", "GET", undefined, cookie)).data;
      assert.equal(state.setupRequired, false);
      assert.equal(state.user.username, "owner");
      assert.equal(state.user.email, undefined);
      assert.equal(
        (
          await call("/auth/setup", "POST", {
            username: "other",
            password: "other-strong-password",
            confirmPassword: "other-strong-password",
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call("/auth/login", "POST", {
            username: "owner",
            password: "wrong-test-password",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await call("/auth/login", "POST", {
            username: "owner",
            password: "very-strong-test-password",
          })
        ).status,
        200,
      );
      const p1 = randomUUID(),
        p2 = randomUUID();
      const key = "secret-fixture-key-not-for-browser";
      const provider = {
        name: "Fixture OpenAI",
        type: "openai",
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: key,
        models: [
          { id: "image-model", name: "Image", kind: "image", canEdit: true },
          { id: "broken-model", name: "Broken", kind: "image", canEdit: true },
          { id: "text-model", name: "Text", kind: "text", canEdit: false },
        ],
      };
      const discovered = await call(
        "/providers/models",
        "POST",
        { baseUrl: provider.baseUrl, apiKey: key },
        cookie,
      );
      assert.equal(discovered.status, 200);
      assert.equal(discovered.data.models.length, 48);
      assert.equal(
        discovered.data.models.find(
          (m: { id: string }) => m.id === "image-model",
        ).canEdit,
        true,
      );
      assert.equal(
        discovered.data.models.find(
          (m: { id: string }) => m.id === "broken-model",
        ).canEdit,
        false,
      );
      assert.equal(
        discovered.data.models.find(
          (m: { id: string }) => m.id === "gpt-image-1",
        ).kind,
        "image",
      );
      assert.ok(!JSON.stringify(discovered.data).includes(key));
      assert.equal(
        (
          await call(
            "/providers/models",
            "POST",
            { baseUrl: provider.baseUrl, apiKey: "wrong" },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call("/providers/models", "POST", {
            baseUrl: provider.baseUrl,
            apiKey: key,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await call(
            "/providers/models",
            "POST",
            { baseUrl: `http://127.0.0.1:${upstreamPort}/empty`, apiKey: key },
            cookie,
          )
        ).data.models.length,
        0,
      );
      assert.equal(
        (
          await call(
            "/providers/models",
            "POST",
            {
              baseUrl: `http://127.0.0.1:${upstreamPort}/invalid`,
              apiKey: key,
            },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "/providers/" + p1,
            "PUT",
            {
              ...provider,
              models: [
                {
                  id: "invented-id",
                  name: "Not listed",
                  kind: "image",
                  canEdit: true,
                },
              ],
            },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        discovered.data.models.find(
          (m: { id: string }) => m.id === "vision-only",
        ).kind,
        "text",
      );
      assert.equal(
        discovered.data.models.find(
          (m: { id: string }) => m.id === "legacy-modality",
        ).canEdit,
        true,
      );
      assert.equal(
        discovered.data.models.find(
          (m: { id: string }) => m.id === "models-dev-format",
        ).kind,
        "image",
      );
      const routerCatalog = await call(
        "/providers/models",
        "POST",
        { baseUrl: provider.baseUrl, apiKey: key, type: "openrouter" },
        cookie,
      );
      assert.equal(routerCatalog.status, 200);
      assert.equal(routerCatalog.data.models.length, 49);
      assert.equal(
        routerCatalog.data.models.filter(
          (m: { id: string }) => m.id === "router-model",
        ).length,
        1,
      );
      assert.equal(
        routerCatalog.data.models.find(
          (m: { id: string }) => m.id === "router-model",
        ).imageApi,
        "images",
      );
      assert.equal(
        routerCatalog.data.models.find(
          (m: { id: string }) => m.id === "image-model",
        ).imageApi,
        "chat",
      );
      assert.equal(
        routerCatalog.data.models.find(
          (m: { id: string }) => m.id === "bytedance-seed/seedream-fixture",
        ).kind,
        "image",
      );
      const paged = await call(
        "/providers/models",
        "POST",
        {
          baseUrl: `http://127.0.0.1:${upstreamPort}/paged`,
          apiKey: key,
          type: "openrouter",
        },
        cookie,
      );
      assert.equal(paged.status, 200);
      assert.deepEqual(
        paged.data.models.map((m: { id: string }) => m.id),
        ["first", "second"],
      );
      assert.equal(
        (
          await call(
            "/providers/models",
            "POST",
            { baseUrl: `http://127.0.0.1:${upstreamPort}/unsafe`, apiKey: key },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "/providers/models",
            "POST",
            {
              baseUrl: `http://127.0.0.1:${upstreamPort}/unavailable`,
              apiKey: key,
              type: "openrouter",
            },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal((await call("/providers", "POST", provider)).status, 401);
      const createdProvider = await call(
        "/providers",
        "POST",
        { ...provider, name: "Server generated ID" },
        cookie,
      );
      assert.equal(createdProvider.status, 200);
      const newProvider = createdProvider.data.providers.find(
        (p: { name: string }) => p.name === "Server generated ID",
      );
      assert.match(
        newProvider.id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      assert.ok(!JSON.stringify(createdProvider.data).includes(key));
      assert.equal(
        (
          await call(
            "/providers/" + newProvider.id,
            "DELETE",
            undefined,
            cookie,
          )
        ).status,
        200,
      );
      const configured = await call(
        "/providers/" + p1,
        "PUT",
        provider,
        cookie,
      );
      assert.equal(configured.status, 200);
      const manyModels = await call(
        "/providers/" + p1,
        "PUT",
        {
          ...provider,
          apiKey: undefined,
          models: discovered.data.models,
        },
        cookie,
      );
      assert.equal(manyModels.status, 200);
      assert.equal(
        manyModels.data.providers.find((p: { id: string }) => p.id === p1)
          .models.length,
        48,
      );
      assert.equal(
        (
          await call(
            "/providers/models",
            "POST",
            { providerId: p1, baseUrl: provider.baseUrl },
            cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            "/providers/models",
            "POST",
            { providerId: p1, baseUrl: provider.baseUrl + "/changed" },
            cookie,
          )
        ).status,
        400,
      );
      assert.ok(!JSON.stringify(configured.data).includes(key));
      assert.equal(
        (
          await call(
            "/providers/" + p2,
            "PUT",
            {
              ...provider,
              name: "Fixture OpenRouter",
              type: "openrouter",
              models: [
                {
                  id: "image-model",
                  name: "Chat image",
                  kind: "image",
                  canEdit: true,
                },
                {
                  id: "router-model",
                  name: "Router",
                  kind: "image",
                  canEdit: true,
                },
              ],
            },
            cookie,
          )
        ).status,
        200,
      );
      const estimateRequest = {
        models: [{ providerId: p2, modelId: "router-model" }],
        options: { ...defaultOptions, count: 3 },
        prompt: "花瓶",
      };
      const estimate = await call(
        "/estimates",
        "POST",
        estimateRequest,
        cookie,
      );
      assert.equal(estimate.status, 200);
      assert.equal(estimate.data[0].cost.minUsd, 0.12);
      assert.equal(estimate.data[0].cost.maxUsd, 0.12);
      assert.ok(!JSON.stringify(estimate.data).includes(key));
      await call("/estimates", "POST", estimateRequest, cookie);
      assert.equal(
        requests.filter(
          (r) => r.url === "/v1/images/models/router-model/endpoints",
        ).length,
        1,
      );
      assert.equal(
        (
          await call(
            "/estimates",
            "POST",
            {
              ...estimateRequest,
              models: [{ providerId: p2, modelId: "missing" }],
            },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (await call("/optimize", "POST", { prompt: "花瓶" }, cookie)).status,
        400,
      );
      await call(
        "/settings/text-model",
        "PUT",
        { providerId: p1, modelId: "text-model" },
        cookie,
      );
      assert.equal(
        (await call("/optimize", "POST", { prompt: "花瓶" }, cookie)).data
          .prompt,
        "优化后的自然光静物摄影提示词",
      );
      const chatTask = await call(
        "/tasks",
        "POST",
        {
          prompt: "chat-image-check",
          options: { ...defaultOptions, size: "864x1536", quality: "high" },
          models: [{ providerId: p2, modelId: "image-model" }],
        },
        cookie,
      );
      assert.equal(chatTask.status, 201);
      let chatComplete = false;
      for (let i = 0; i < 80; i++) {
        const all = await call("/tasks", "GET", undefined, cookie);
        const t = all.data.find((t: Task) => t.id === chatTask.data.id);
        if (t && taskStatus(t) !== "running") {
          assert.equal(taskStatus(t), "completed");
          chatComplete = true;
          break;
        }
        await sleep(100);
      }
      assert.ok(chatComplete);
      const chatBody = JSON.parse(requests.find(
        (r) => r.url === "/v1/chat/completions" && r.body.includes("chat-image-check"),
      )!.body);
      assert.equal(chatBody.image_config.aspect_ratio, "9:16");
      assert.match(chatBody.messages[0].content, /864 × 1536/);
      assert.match(chatBody.messages[0].content, /高画质/);
      assert.equal(chatTask.data.prompt, "chat-image-check");
      assert.ok(
        requests.some(
          (r) =>
            r.url === "/v1/chat/completions" &&
            r.body.includes("chat-image-check"),
        ),
      );
      const input = {
        prompt: "原始测试提示词",
        options: { ...defaultOptions, size: "1536x864", quality: "high" },
        models: [
          { providerId: p1, modelId: "image-model" },
          { providerId: p1, modelId: "broken-model" },
          { providerId: p2, modelId: "router-model" },
        ],
      };
      const created = await call("/tasks", "POST", input, cookie);
      assert.equal(created.status, 201);
      assert.equal(created.data.prompt, input.prompt);
      const id = created.data.id;
      async function settled(): Promise<Task> {
        for (let i = 0; i < 80; i++) {
          const all = await call("/tasks", "GET", undefined, cookie);
          const t = all.data.find((t: Task) => t.id === id);
          if (t && taskStatus(t) !== "running") return t;
          await sleep(150);
        }
        throw new Error("Task timeout");
      }
      let task = await settled();
      assert.equal(taskStatus(task), "partial");
      assert.equal(task.results[0].images.length, 1);
      assert.match(task.results[1].error!, /429/);
      assert.equal(task.results[2].images.length, 1);
      failModel = false;
      assert.equal(
        (
          await call(
            `/tasks/${id}/retry/${task.results[1].id}`,
            "POST",
            undefined,
            cookie,
          )
        ).status,
        200,
      );
      task = await settled();
      assert.equal(taskStatus(task), "completed");
      assert.equal(
        (
          await call(
            task.results[0].images[0].replace("/api", ""),
            "GET",
            undefined,
            cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            `/tasks/${id}/edit`,
            "POST",
            {
              resultId: task.results[0].id,
              image: task.results[0].images[0],
              changes: "把背景改成蓝色",
            },
            cookie,
          )
        ).status,
        201,
      );
      task = await settled();
      assert.equal(task.results.length, 4);
      assert.equal(task.results[3].parentId, task.results[0].id);
      const editRequest = requests.find((r) => r.url === "/v1/images/edits");
      assert.ok(editRequest);
      assert.match(editRequest.contentType, /multipart\/form-data/);
      assert.match(editRequest.body, /原始测试提示词/);
      assert.match(editRequest.body, /把背景改成蓝色/);
      assert.match(editRequest.body, /16:9/);
      assert.match(editRequest.body, /1536 × 864/);
      assert.equal(editRequest.body.split("[输出规格]").length - 1, 1);
      assert.match(editRequest.body, /filename="source.png"/);
      await call(
        `/tasks/${id}/edit`,
        "POST",
        {
          resultId: task.results[2].id,
          image: task.results[2].images[0],
          changes: "保留主体",
        },
        cookie,
      );
      task = await settled();
      assert.equal(task.results[4].status, "completed");
      const nativeEdit = requests.find(
        (r) => r.url === "/v1/images" && r.body.includes("保留主体"),
      );
      assert.ok(nativeEdit);
      const nativeBody = JSON.parse(nativeEdit.body);
      assert.equal(nativeBody.model, "router-model");
      assert.equal(nativeBody.aspect_ratio, "16:9");
      assert.equal(nativeBody.size, "1536x864");
      assert.equal(nativeBody.quality, "high");
      assert.match(nativeBody.prompt, /高画质/);
      const directBody = JSON.parse(requests.find(
        (r) => r.url === "/v1/images/generations" && r.body.includes("原始测试提示词"),
      )!.body);
      assert.equal(directBody.size, "1536x864");
      assert.equal(directBody.quality, "high");
      assert.match(directBody.prompt, /16:9/);
      assert.ok(
        nativeBody.input_references[0].image_url.url.startsWith(
          "data:image/png;base64,",
        ),
      );
      assert.ok(nativeBody.prompt.includes("原始测试提示词"));
      assert.ok(
        requests.some(
          (r) => r.body.includes("image_url") && r.body.includes("保留主体"),
        ),
      );
      const favoriteImage = task.results[0].images[0];
      const star = await call(
        `/tasks/${id}/favorites`,
        "PATCH",
        { image: favoriteImage, favorite: true },
        cookie,
      );
      assert.deepEqual(star.data.favoriteImages, [favoriteImage]);
      assert.deepEqual(
        (
          await call(
            `/tasks/${id}/favorites`,
            "PATCH",
            { image: favoriteImage, favorite: true },
            cookie,
          )
        ).data.favoriteImages,
        [favoriteImage],
      );
      assert.equal(
        (
          await call(
            `/tasks/${id}/favorites`,
            "PATCH",
            { image: "/api/images/not-owned", favorite: true },
            cookie,
          )
        ).status,
        404,
      );
      assert.deepEqual(
        (
          await call(
            `/tasks/${id}/favorites`,
            "PATCH",
            { image: favoriteImage, favorite: false },
            cookie,
          )
        ).data.favoriteImages,
        [],
      );
      await call(
        `/tasks/${id}/favorites`,
        "PATCH",
        { image: favoriteImage, favorite: true },
        cookie,
      );
      assert.equal(
        (
          await call(
            "/auth/register",
            "POST",
            { username: "second", password: "second-strong-password" },
            cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await call("/auth/login", "POST", {
            username: "second",
            password: "second-strong-password",
          })
        ).status,
        401,
      );
      assert.equal((await call("/settings")).status, 401);
      assert.equal(
        (
          await call(`/tasks/${id}/favorites`, "PATCH", {
            image: favoriteImage,
            favorite: false,
          })
        ).status,
        401,
      );
      assert.equal(
        (await call(task.results[0].images[0].replace("/api", ""))).status,
        401,
      );
      const csrf = await fetch(base + "/api/tasks", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify(input),
      });
      assert.equal(csrf.status, 403);
      const raw = Buffer.concat(
        await Promise.all(
          ["frame.sqlite", "frame.sqlite-wal"].map((f) =>
            readFile(path.join(directory, f)).catch(() => Buffer.alloc(0)),
          ),
        ),
      );
      assert.ok(!raw.includes(Buffer.from(key)));
      await stop();
      const legacyId = randomUUID();
      const legacyAsset = randomUUID();
      const legacyImage = "/api/images/" + legacyAsset;
      const legacyDb = new DatabaseSync(path.join(directory, "frame.sqlite"));
      const owner = (
        legacyDb.prepare("SELECT user_id FROM tasks WHERE id=?").get(id) as {
          user_id: string;
        }
      ).user_id;
      const legacyTask = {
        ...task,
        id: legacyId,
        favorite: true,
        results: [{ ...task.results[0], images: [legacyImage] }],
      };
      delete legacyTask.favoriteImages;
      legacyDb
        .prepare("INSERT INTO tasks VALUES (?,?,?)")
        .run(legacyId, owner, JSON.stringify(legacyTask));
      legacyDb
        .prepare("INSERT INTO assets (id,user_id,mime) VALUES (?,?,?)")
        .run(legacyAsset, owner, "image/png");
      legacyDb.close();
      await writeFile(
        path.join(directory, "images", legacyAsset),
        Buffer.from(pixel, "base64"),
      );
      await start();
      assert.deepEqual(
        (await call("/tasks", "GET", undefined, cookie)).data.find(
          (t: Task) => t.id === legacyId,
        ).favoriteImages,
        [legacyImage],
      );
      assert.equal(
        (await call("/tasks/" + legacyId, "DELETE", undefined, cookie)).status,
        200,
      );
      await assert.rejects(
        readFile(path.join(directory, "images", legacyAsset)),
      );
      assert.equal((await call("/auth/me")).data.setupRequired, false);
      assert.equal(
        (
          await call("/auth/setup", "POST", {
            username: "reset",
            password: "reset-strong-password",
            confirmPassword: "reset-strong-password",
          })
        ).status,
        409,
      );
      assert.deepEqual(
        (await call("/tasks", "GET", undefined, cookie)).data.find(
          (t: Task) => t.id === id,
        ).favoriteImages,
        [favoriteImage],
      );
      assert.equal((await call(`/tasks/${id}`, "DELETE")).status, 401);
      const deleting = (
        await call("/tasks", "GET", undefined, cookie)
      ).data.find((t: Task) => t.id === id) as Task;
      assert.equal(
        (await call(`/tasks/${id}`, "DELETE", undefined, cookie)).status,
        200,
      );
      for (const image of deleting.results.flatMap((r) => r.images)) {
        assert.equal(
          (await call(image.replace("/api", ""), "GET", undefined, cookie))
            .status,
          404,
        );
        await assert.rejects(
          readFile(path.join(directory, "images", image.split("/").pop()!)),
        );
      }
      assert.ok(
        !(await call("/tasks", "GET", undefined, cookie)).data.some(
          (t: Task) => t.id === id,
        ),
      );
      assert.equal(
        (await call(`/tasks/${id}`, "DELETE", undefined, cookie)).status,
        404,
      );
      const beforeFiles = (
        await readdir(path.join(directory, "images"))
      ).sort();
      const inFlight = await call(
        "/tasks",
        "POST",
        {
          prompt: "delete in flight",
          models: [{ providerId: p1, modelId: "image-model" }],
          options: defaultOptions,
        },
        cookie,
      );
      for (let i = 0; i < 40 && !releaseGeneration; i++) await sleep(100);
      assert.ok(releaseGeneration, "generation reached upstream");
      assert.equal(
        (await call("/tasks/" + inFlight.data.id, "DELETE", undefined, cookie))
          .status,
        200,
      );
      releaseGeneration();
      await sleep(500);
      assert.deepEqual(
        (await readdir(path.join(directory, "images"))).sort(),
        beforeFiles,
      );
      assert.ok(
        !(await call("/tasks", "GET", undefined, cookie)).data.some(
          (t: Task) => t.id === inFlight.data.id,
        ),
      );
      const savedProvider = (
        await call("/settings", "GET", undefined, cookie)
      ).data.providers.find((p: { id: string }) => p.id === p2);
      const beforeLocalSave = requests.length;
      assert.equal(
        (
          await call(
            "/settings/default-image-model",
            "PUT",
            { providerId: p2, modelId: "router-model" },
            cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            "/settings/default-image-model",
            "PUT",
            { providerId: p1, modelId: "text-model" },
            cookie,
          )
        ).status,
        400,
      );
      const localSave = await call(
        "/providers/" + p2,
        "PUT",
        {
          ...savedProvider,
          name: "Renamed without discovery",
          models: savedProvider.models
            .filter((m: { id: string }) => m.id === "router-model")
            .map((m: object) => ({ ...m, imageApi: "chat" })),
        },
        cookie,
      );
      assert.equal(localSave.status, 200);
      const retained = localSave.data.providers.find(
        (p: { id: string }) => p.id === p2,
      );
      assert.equal(retained.models.length, 1);
      assert.equal(retained.models[0].imageApi, "images");
      assert.deepEqual(localSave.data.defaultImageModel, {
        providerId: p2,
        modelId: "router-model",
      });
      assert.equal(
        requests.length,
        beforeLocalSave,
        "local edits must not contact provider",
      );
      const emptySave = await call(
        "/providers/" + p2,
        "PUT",
        { ...savedProvider, models: [] },
        cookie,
      );
      assert.equal(emptySave.status, 200);
      assert.equal(emptySave.data.defaultImageModel, null);
      assert.equal(
        emptySave.data.providers.find((p: { id: string }) => p.id === p2).models
          .length,
        0,
      );
      assert.equal(
        requests.length,
        beforeLocalSave,
        "removing all models must not contact provider",
      );
      await call("/auth/logout", "POST", undefined, cookie);
      assert.equal(
        (await call("/tasks", "GET", undefined, cookie)).status,
        401,
      );
    } finally {
      releaseGeneration?.();
      await stop();
      await new Promise<void>((r) => upstream.close(() => r()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
