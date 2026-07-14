import type { ScreenEvaluation } from "@kestrel/core/types";
import { utcIsoDate } from "@kestrel/core/types/guards";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./_lib/auth";
import { money, percent } from "./_lib/format";
import {
  getDashboardData,
  registry,
  repository,
  userTickers,
  webConfig,
} from "./_lib/pipeline";
import { SignOut } from "./SignOut";
import { WatchlistManager } from "./WatchlistManager";

/**
 * The §8 dashboard as HTML: three category sections with the exact
 * per-row fields of MVP.md §8, native currency ("?" when unreported),
 * disabled screens shown with their missing capabilities (guardrail 4),
 * and research-candidates framing throughout.
 *
 * The dashboard is private (item 020, ADR-0013): an unauthenticated request
 * is redirected to /sign-in before any data is read. `/api/ingest` stays
 * machine-auth (CRON_SECRET), NOT session-gated.
 *
 * Always rendered from live storage (force-dynamic): a cached page would
 * present stale data as fresh. The `new Date()` below is one of the
 * sanctioned wall-clock reads — they live only in the composition-root
 * entrypoints (this page and the cron route); everything below
 * takes the injected as-of date (guardrail 2).
 */
export const dynamic = "force-dynamic";

// The watchlist add/remove server actions are invoked against this route
// segment, so its ceiling governs them. `addTicker` awaits a throttled
// kick-on-add backfill (~a handful of interCallDelayMs-spaced calls), which
// can exceed the default function timeout; give it headroom (item 021). 60 is
// the Hobby ceiling without Fluid compute (see docs/deploy.md §5).
export const maxDuration = 60;

export default async function DashboardPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }
  const asOf = utcIsoDate(new Date());
  const tickers = await userTickers(session.user.id);
  const data = await getDashboardData(
    repository(),
    registry(asOf),
    webConfig(),
    asOf,
    tickers,
  );
  return (
    <main>
      <header className="topbar">
        <h1>Kestrel — research candidates as of {data.asOf}</h1>
        <SignOut email={session.user.email} />
      </header>
      <p className="framing">
        Candidates for further research, not recommendations. Prices in each
        instrument&apos;s native currency.
      </p>
      <WatchlistManager tickers={tickers} />
      <Section
        title="Category 1 — volatile + undervalued"
        evaluation={data.category1}
        headers={[
          "ticker",
          "upside",
          "median target",
          "latest close",
          "analysts",
          "fluctuations",
        ]}
        row={(m) => [
          m.ticker,
          percent(m.impliedUpside),
          money(m.medianTarget, m.currency),
          money(m.latestClose, m.currency),
          String(m.numAnalysts),
          String(m.completedFluctuations),
        ]}
      />
      <Section
        title="Category 2 — pre-earnings + undervalued"
        evaluation={data.category2}
        headers={[
          "ticker",
          "upside",
          "days to earnings",
          "earnings date",
          "analysts",
        ]}
        row={(m) => [
          m.ticker,
          percent(m.impliedUpside),
          String(m.daysToEarnings),
          m.nextEarningsDate,
          String(m.numAnalysts),
        ]}
      />
      <Section
        title="Category 3 — pre-ex-dividend + undervalued"
        evaluation={data.category3}
        headers={[
          "ticker",
          "upside",
          "days to ex-div",
          "ex-div date",
          "analysts",
        ]}
        row={(m) => [
          m.ticker,
          percent(m.impliedUpside),
          String(m.daysToExDiv),
          m.nextExDivDate,
          String(m.numAnalysts),
        ]}
      />
    </main>
  );
}

/** One category section: table when enabled, visible state otherwise. */
function Section<Match extends { ticker: string }>({
  title,
  evaluation,
  headers,
  row,
}: {
  title: string;
  evaluation: ScreenEvaluation<Match>;
  headers: readonly string[];
  row: (match: Match) => string[];
}) {
  return (
    <section>
      <h2>{title}</h2>
      {!evaluation.resolution.enabled ? (
        <p className="disabled">
          unavailable — missing capability:{" "}
          {evaluation.resolution.missing.join(", ")}
        </p>
      ) : evaluation.matches.length === 0 ? (
        <p className="empty">no matches</p>
      ) : (
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evaluation.matches.map((match) => (
              <tr key={match.ticker}>
                {row(match).map((cell, i) => (
                  <td key={headers[i] ?? i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
