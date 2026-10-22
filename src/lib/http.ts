import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  return schema.parse(raw);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler with consistent JSON errors. */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) return json({ error: "Invalid request", issues: e.issues }, { status: 400 });
      console.error(e);
      return json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
    }
  };
}

export type Params<T extends Record<string, string | string[]>> = { params: Promise<T> };
