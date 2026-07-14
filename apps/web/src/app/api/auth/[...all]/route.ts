import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "../../../_lib/auth";

/**
 * better-auth's catch-all handler (item 020): mounts every auth endpoint
 * (sign-in, OAuth callback, session, sign-out) under /api/auth/*.
 *
 * The instance is resolved lazily INSIDE each handler via getAuth(), never
 * at module scope: `next build` must succeed without DATABASE_URL /
 * BETTER_AUTH_SECRET (CI builds without them), and better-auth throws on a
 * missing production secret — that fail-loud belongs at request time
 * (guardrail 6), not at build.
 */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
