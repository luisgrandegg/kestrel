import { utcIsoDate } from "@kestrel/core/types/guards";
import { isAuthorized } from "../../_lib/auth";
import { runIngestion } from "../../_lib/pipeline";

/**
 * The ingest worker's trigger (ADR-0011): Vercel Cron GETs this route on
 * the schedule in vercel.json (30 23 * * * UTC — well after the US close),
 * authenticated with `Authorization: Bearer ${CRON_SECRET}`. It is the sole
 * scheduled ingestion path (ADR-0013 retired the GitHub Action).
 *
 * The pipeline is idempotent + resumable by design (guardrail 7), so a
 * function timeout mid-backfill just resumes on the next fire, and a
 * manual re-trigger on the same day is a no-op. `maxDuration` raises the
 * function ceiling (plan-dependent; see docs/deploy.md for the escape
 * hatch of moving packages/ingest to a dedicated runner).
 *
 * The `new Date()` below is one of the sanctioned wall-clock reads — they
 * live only in the composition-root entrypoints; everything below takes
 * the injected UTC calendar date (guardrail 2).
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    // Fail loud at the handler edge: an unset secret must never mean an
    // open route (and must never be mistaken for a bad caller — 500, not 401).
    return Response.json(
      {
        error:
          "CRON_SECRET is not set — refusing to expose the ingest route unauthenticated (see docs/deploy.md)",
      },
      { status: 500 },
    );
  }
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = utcIsoDate(new Date());
  try {
    const outcome = await runIngestion(today);
    return Response.json({ today, ...outcome });
  } catch (error) {
    return Response.json(
      {
        today,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
