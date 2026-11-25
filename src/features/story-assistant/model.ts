type LocalModel = {
  availability(options?: object): Promise<string>;
  create(options?: object): Promise<{
    prompt(input: string, options: { responseConstraint: object; signal?: AbortSignal }): Promise<string>;
    destroy(): void;
  }>;
};

export async function askLocalModel(input: string, responseConstraint: object, signal?: AbortSignal): Promise<unknown> {
  const model = (globalThis as typeof globalThis & { LanguageModel?: LocalModel }).LanguageModel;
  if (!model) throw new Error("Browser model unavailable");
  const options = { signal };
  const status = await model.availability();
  if (!["available", "downloadable", "downloading"].includes(status)) {
    throw new Error("Browser model unavailable");
  }
  const session = await model.create(options);
  try {
    return JSON.parse(await session.prompt(input, { responseConstraint, signal }));
  } finally {
    session.destroy();
  }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function normalizedName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
