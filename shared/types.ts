export type Model = {
  id: string;
  name: string;
  kind: "image" | "text";
  canEdit: boolean;
  imageApi?: "images" | "chat";
};
export type Provider = {
  id: string;
  name: string;
  type: "openai" | "openrouter";
  baseUrl: string;
  models: Model[];
  hasKey: boolean;
};
export type Options = {
  size: "1024x1024" | "1536x1024" | "1024x1536";
  quality: "auto" | "low" | "medium" | "high";
  count: number;
  background: "auto" | "opaque" | "transparent";
};
export type Result = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  canEdit: boolean;
  status: "queued" | "running" | "completed" | "failed";
  images: string[];
  error?: string;
  parentId?: string;
  sourceImage?: string;
  changes?: string;
  createdAt: string;
  elapsed?: number;
};
export type Task = {
  id: string;
  title: string;
  prompt: string;
  options: Options;
  createdAt: string;
  favoriteImages?: string[];
  results: Result[];
};
export type User = { id: string; name: string; username: string };
export type Settings = {
  providers: Provider[];
  defaultImageModel?: { providerId: string; modelId: string } | null;
  textModel: { providerId: string; modelId: string } | null;
};
export const defaultOptions: Options = {
  size: "1024x1024",
  quality: "auto",
  count: 1,
  background: "auto",
};
export function taskStatus(t: Task) {
  if (t.results.some((r) => r.status === "queued" || r.status === "running"))
    return "running";
  if (t.results.every((r) => r.status === "failed")) return "failed";
  if (t.results.some((r) => r.status === "failed")) return "partial";
  return "completed";
}
