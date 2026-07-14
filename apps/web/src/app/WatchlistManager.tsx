"use client";

import { useActionState } from "react";
import {
  type AddTickerResult,
  addTickerAction,
  removeTickerAction,
} from "./_lib/actions";

/**
 * Per-user watchlist management (item 021): the signed-in user adds/removes
 * their own tickers. Adding kicks an immediate backfill server-side; removing
 * drops the ticker from the ingestion union (its history is retained). When
 * the list is empty, this is the front-and-centre empty state that guides a
 * just-created user to add their first ticker.
 */
export function WatchlistManager({
  tickers,
}: {
  tickers: readonly string[];
}): React.JSX.Element {
  const [addResult, add, adding] = useActionState<
    AddTickerResult | null,
    FormData
  >(addTickerAction, null);

  return (
    <section className="watchlist">
      <h2>Your watchlist</h2>
      {tickers.length === 0 ? (
        <p className="empty">
          You aren&apos;t tracking any tickers yet. Add one below to start —
          it&apos;s fetched and screened for you automatically.
        </p>
      ) : (
        <ul className="tickers">
          {tickers.map((ticker) => (
            <li key={ticker}>
              <span className="ticker">{ticker}</span>
              <form action={removeTickerAction}>
                <input type="hidden" name="ticker" value={ticker} />
                <button type="submit" aria-label={`Remove ${ticker}`}>
                  remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={add} className="add-ticker">
        <input
          name="ticker"
          placeholder="e.g. AAPL"
          aria-label="Ticker symbol to add"
          autoComplete="off"
          required
        />
        <button type="submit" disabled={adding}>
          {adding ? "Adding…" : "Add ticker"}
        </button>
      </form>
      {addResult && (
        <p className={addResult.ok ? "framing" : "error"} role="status">
          {addResult.message}
        </p>
      )}
    </section>
  );
}
