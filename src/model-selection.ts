import type { Settings } from "../shared/types";

export const lastModelsKey = "frame.last-generation-models.v1";
export function initialModels(
  settings: Settings,
  stored: string | null,
): string[] {
  const valid = new Set(
    settings.providers.flatMap((p) =>
      p.models.filter((m) => m.kind === "image").map((m) => p.id + "|" + m.id),
    ),
  );
  try {
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (Array.isArray(parsed)) {
      const restored = [
        ...new Set(
          parsed.filter(
            (id): id is string => typeof id === "string" && valid.has(id),
          ),
        ),
      ].slice(0, 10);
      if (restored.length) return restored;
    }
  } catch {
    /* Invalid browser data falls back to the configured default. */
  }
  const choice = settings.defaultImageModel;
  const id = choice ? choice.providerId + "|" + choice.modelId : "";
  return valid.has(id) ? [id] : [];
}
