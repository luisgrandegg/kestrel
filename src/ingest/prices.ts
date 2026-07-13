import type { Repository } from "../storage/repository.js";
import type { DailyClose, IsoDate } from "../types/index.js";
import { addDays } from "./dates.js";
import { ProviderCallError, type Throttle } from "./throttle.js";

export type FetchCloses = (
  ticker: string,
  from: IsoDate,
  to: IsoDate,
) => Promise<DailyClose[]>;

/**
 * Fetch and store the missing slice of a ticker's price history — shared by
 * backfill (item 012) and the daily incremental refresh (item 013).
 *
 * The cursor is always the latest stored close (never `lastPriceSync`,
 * which is only an attempt marker); a fresh instrument starts at the
 * beginning of the backfill window. Bounds are inclusive (Provider
 * contract), so the resume cursor is the day after the latest close. An
 * empty return is a legitimate no-op (weekends/holidays).
 */
export async function syncPrices(
  repo: Repository,
  fetchCloses: FetchCloses,
  throttle: Throttle,
  ticker: string,
  today: IsoDate,
  backfillLookbackDays: number,
): Promise<void> {
  const latest = repo.latestClose(ticker, today);
  const from =
    latest === undefined
      ? addDays(today, -backfillLookbackDays)
      : addDays(latest.date, 1);
  if (from <= today) {
    const closes = await throttle(() => fetchCloses(ticker, from, today));
    validateProviderCloses(ticker, today, closes);
    repo.insertCloses(closes);
  }
  // Attempt marker only — never a coverage watermark (a capped fetch still
  // stamps today). The incremental cursor is always latestClose.
  repo.recordPriceSync(ticker, today);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate provider-returned closes at the last edge before append-only
 * storage, where a bad row could never be removed: the ticker must echo the
 * request, dates must be well-formed and never in the future (a future date
 * is a delayed cursor bomb). Benign over-return of older dates is allowed —
 * insert-or-ignore handles it. Violations are provider failures and feed
 * the streak.
 */
export function validateProviderCloses(
  ticker: string,
  to: IsoDate,
  closes: readonly DailyClose[],
): void {
  for (const close of closes) {
    if (close.ticker !== ticker) {
      throw new ProviderCallError(
        new RangeError(
          `provider returned a close for "${close.ticker}" when "${ticker}" was requested`,
        ),
      );
    }
    if (!ISO_DATE.test(close.date)) {
      throw new ProviderCallError(
        new RangeError(
          `provider returned a malformed close date "${close.date}" for ${ticker}`,
        ),
      );
    }
    if (close.date > to) {
      throw new ProviderCallError(
        new RangeError(
          `provider returned a future-dated close ${close.date} > ${to} for ${ticker}`,
        ),
      );
    }
  }
}
