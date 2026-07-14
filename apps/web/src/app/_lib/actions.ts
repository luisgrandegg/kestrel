"use server";

import { utcIsoDate } from "@kestrel/core/types/guards";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAuth } from "./auth";
import { addTicker, removeTicker } from "./pipeline";

/**
 * Server actions for per-user watchlist management (item 021). Each resolves
 * the caller's own user id from the better-auth session — a user can only
 * ever mutate their OWN watchlist (per-user isolation). `new Date()` here is
 * a sanctioned composition-root wall-clock read (guardrail 2): it becomes the
 * run/as-of date injected into the kicked backfill.
 */

async function requireUserId(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    throw new Error("Not authenticated");
  }
  return session.user.id;
}

export interface AddTickerResult {
  ok: boolean;
  message: string;
}

/**
 * Add a ticker to the caller's watchlist (form action via useActionState).
 * Returns a result rather than throwing so the UI can show validation errors
 * inline (an empty/blank symbol fails normalization).
 */
export async function addTickerAction(
  _previous: AddTickerResult | null,
  formData: FormData,
): Promise<AddTickerResult> {
  const userId = await requireUserId();
  const raw = String(formData.get("ticker") ?? "");
  try {
    const ticker = await addTicker(userId, raw, utcIsoDate(new Date()));
    revalidatePath("/");
    return { ok: true, message: `Added ${ticker}.` };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not add that ticker.",
    };
  }
}

/** Remove a ticker from the caller's watchlist. Blank input is a no-op. */
export async function removeTickerAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const raw = String(formData.get("ticker") ?? "").trim();
  // A blank/absent field is a no-op, not a 500 — normalizeTicker throws on
  // empty, so guard before calling through (a crafted empty POST must not
  // crash the action).
  if (raw !== "") {
    await removeTicker(userId, raw);
  }
  revalidatePath("/");
}
