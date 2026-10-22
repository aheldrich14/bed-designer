import { json, route } from "@/lib/http";
import { plantLibrary } from "@/lib/plants";

export const GET = route(async () =>
  json({ version: plantLibrary.version, region: plantLibrary.region, note: plantLibrary.note, plants: plantLibrary.all() }),
);
