import * as repo from "@/lib/db/repo";
import { HttpError, json, route, type Params } from "@/lib/http";
import { newId } from "@/lib/plan";
import { requireBed } from "@/lib/services";
import { extFor, fileStore } from "@/lib/storage";

export const POST = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const bed = requireBed(id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach an image as 'file'.");
  const url = await fileStore.save("photos", Buffer.from(await file.arrayBuffer()), extFor(file.type, file.name));
  const isStreetView = form.get("street") === "true" || !bed.photos.some((p) => p.isStreetView);
  const photo = { id: newId("ph_"), url, caption: String(form.get("caption") ?? file.name), isStreetView };
  const photos = [...bed.photos.map((p) => (isStreetView ? { ...p, isStreetView: false } : p)), photo];
  return json({ bed: repo.updateBed(id, { photos }) });
});
