import * as repo from "@/lib/db/repo";
import { HttpError, json, notFound, route, type Params } from "@/lib/http";
import { extFor, fileStore } from "@/lib/storage";

export const POST = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  if (!repo.getProject(id)) throw notFound("Project");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach an image as 'file'.");
  const w = Number(form.get("width"));
  const h = Number(form.get("height"));
  const url = await fileStore.save("aerials", Buffer.from(await file.arrayBuffer()), extFor(file.type, file.name));
  // A new image invalidates the old calibration.
  const project = repo.updateProject(id, { aerialUrl: url, aerialSize: w && h ? { w, h } : null, calibration: null });
  return json({ project });
});
