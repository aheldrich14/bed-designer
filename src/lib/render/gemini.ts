import type { RenderOutput, RenderProvider, RenderRequest } from "./provider";

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string } };

/** Gemini image generation/editing over the REST API. */
export class GeminiRenderProvider implements RenderProvider {
  readonly name: string;
  constructor(
    private apiKey = process.env.GEMINI_API_KEY ?? "",
    private model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
  ) {
    this.name = `Gemini (${this.model})`;
  }

  get available() {
    return !!this.apiKey;
  }

  async render({ prompt, images }: RenderRequest): Promise<RenderOutput> {
    if (!this.apiKey) throw new Error("Set GEMINI_API_KEY to generate renders.");
    // Each image is preceded by its label so the prompt can refer to "image 1", "image 2".
    const parts: GeminiPart[] = images.flatMap((img, i): GeminiPart[] => [
      { text: `Image ${i + 1}:` },
      { inline_data: { mime_type: img.mimeType, data: img.data.toString("base64") } },
    ]);
    parts.push({ text: prompt });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    if (json.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${json.promptFeedback.blockReason}).`);
    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      const inline = part.inlineData ?? (part.inline_data && { mimeType: part.inline_data.mime_type, data: part.inline_data.data });
      if (inline?.data) return { data: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || "image/png" };
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(" ");
    throw new Error(`Gemini returned no image${text ? `: ${text.slice(0, 200)}` : ` (finish reason ${json.candidates?.[0]?.finishReason ?? "unknown"})`}.`);
  }
}

export const renderProvider: RenderProvider = new GeminiRenderProvider();
