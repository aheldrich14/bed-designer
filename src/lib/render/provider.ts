export type RenderRequest = {
  prompt: string;
  reference?: { data: Buffer; mimeType: string } | null;
};

export type RenderOutput = { data: Buffer; mimeType: string };

/** Render seam: Gemini image editing now, other image models later. */
export interface RenderProvider {
  readonly name: string;
  readonly available: boolean;
  render(req: RenderRequest): Promise<RenderOutput>;
}
