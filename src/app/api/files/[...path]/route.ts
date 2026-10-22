import { notFound, route, type Params } from "@/lib/http";
import { fileStore } from "@/lib/storage";

export const GET = route<Params<{ path: string[] }>>(async (_req, { params }) => {
  const { path } = await params;
  const file = await fileStore.read(`/api/files/${path.join("/")}`);
  if (!file) throw notFound("File");
  return new Response(new Uint8Array(file.data), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=31536000, immutable" },
  });
});
