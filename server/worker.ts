import { db, getSettings, getTask, getSecret, saveTask } from "./store.js";
import { generate } from "./providers.js";
import type { Task } from "../shared/types.js";

let active = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const concurrency = Math.max(
  1,
  Math.min(8, Number(process.env.WORKER_CONCURRENCY) || 3),
);
async function execute(userId: string, taskId: string, resultId: string) {
  const task = getTask(userId, taskId)!;
  const result = task.results.find((r) => r.id === resultId)!;
  const start = Date.now();
  try {
    const provider = getSettings(userId).providers.find(
      (p) => p.id === result.providerId,
    );
    if (!provider) throw new Error("接入商已被删除，请重新配置");
    const prompt = result.changes
      ? `原始提示词：\n${task.prompt}\n\n修改要求：\n${result.changes}\n\n基于所附图片完成修改，保留未要求修改的部分。`
      : task.prompt;
    const images = await generate(
      userId,
      provider,
      getSecret(userId, provider.id),
      result.modelId,
      prompt,
      result.changes ? { ...task.options, count: 1 } : task.options,
      result.sourceImage,
    );
    const latest = getTask(userId, taskId);
    if (!latest) return;
    Object.assign(latest.results.find((r) => r.id === resultId)!, {
      images,
      status: "completed",
      elapsed: Date.now() - start,
    });
    saveTask(userId, latest);
  } catch (e) {
    const latest = getTask(userId, taskId);
    if (!latest) return;
    Object.assign(latest.results.find((r) => r.id === resultId)!, {
      status: "failed",
      error: e instanceof Error ? e.message : "生成失败",
      elapsed: Date.now() - start,
    });
    saveTask(userId, latest);
  } finally {
    active--;
  }
}
function tick() {
  if (active >= concurrency) return;
  const rows = db.prepare("SELECT user_id, data FROM tasks").all() as {
    user_id: string;
    data: string;
  }[];
  for (const row of rows) {
    const task: Task = JSON.parse(row.data);
    for (const result of task.results) {
      if (active >= concurrency) return;
      if (result.status !== "queued") continue;
      result.status = "running";
      saveTask(row.user_id, task);
      active++;
      void execute(row.user_id, task.id, result.id);
    }
  }
}
export function startWorker() {
  // An interrupted paid request must never be silently replayed on restart.
  const rows = db.prepare("SELECT user_id,data FROM tasks").all() as {
    user_id: string;
    data: string;
  }[];
  for (const row of rows) {
    const task: Task = JSON.parse(row.data);
    for (const r of task.results)
      if (r.status === "running") {
        r.status = "failed";
        r.error = "服务重启导致请求中断；可手动重试，服务商可能已计费。";
      }
    saveTask(row.user_id, task);
  }
  timer = setInterval(tick, 750);
  tick();
}
export function stopWorker() {
  if (timer) clearInterval(timer);
}
