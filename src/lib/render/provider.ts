export type RenderImage = { data: Buffer; mimeType: string };

export type RenderRequest = {
  prompt: string;
  /** Reference images in the order the prompt names them (image 1, image 2, ...). */
  images: RenderImage[];
};

export type RenderOutput = { data: Buffer; mimeType: string };

/** Render seam: Gemini image editing now, other image models later. */
export interface RenderProvider {
  readonly name: string;
  readonly available: boolean;
  render(req: RenderRequest): Promise<RenderOutput>;
}
