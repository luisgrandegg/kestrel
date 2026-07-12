# MVP — Kestrel

The concrete first slice of Kestrel. Read alongside `constitution.md`, which defines the invariants this MVP must not violate. Where this document gives a formula or default, it is the target; where it would contradict the constitution, the constitution wins.

---

## 1. What ships in the MVP

A runnable tool that:
1. Maintains a user-defined watchlist of tickers.
2. Backfills ~1 year of daily closes per ticker and keeps them current, throttled.
3. Refreshes analyst targets, next-earnings dates, and next-ex-dividend dates on a slower cadence.
4. Evaluates three screens each run and renders matches grouped by category, with the supporting numbers visible.

All three screens light up at launch because the reference provider serves all four required capabilities.

## 2. Reference provider: Yahoo (via `yahoo-finance2`)

The MVP ships **one adapter**, wrapping the `yahoo-finance2` Node library. The registry, adapter interface, and capability-resolution logic are built for **N providers**; we launch with one.

Chosen because it is the only free, no-key source that cleanly serves all four capabilities together — including analyst **median target + analyst count**, which most free tiers omit — and because it is Node/TS-native, so ingestion is a plain Node script that drops into a scheduled GitHub Action.

Capability mapping:

| Capability        | Yahoo source (`yahoo-finance2`)                          |
|-------------------|---------------------------------------------------------|
| `closes`          | `chart()` — daily close series                          |
| `analystTargets`  | `quoteSummary` → `financialData.targetMedianPrice`, `numberOfAnalystOpinions` |
| `earningsCalendar`| `quoteSummary` → `calendarEvents.earnings.earningsDate` |
| `dividendCalendar`| `quoteSummary` → `calendarEvents.exDividendDate` / `summaryDetail.exDividendDate` |

Cost per ticker per run: one `chart` call + one `quoteSummary` call (~2 calls). A 25-ticker watchlist ≈ 50 throttled calls/day. 1-year backfill is a single `chart` call per ticker.

**Known limitation (accepted):** Yahoo is unofficial and scraping-backed; it can break without notice. The registry isolates this — when it breaks or is outgrown, swap the adapter, not the screens. Graduation path: split capabilities across keyed providers (e.g. Finnhub/Twelve Data for closes+earnings, FMP/Alpha Vantage for targets); the capability-merging design lets a screen draw closes from one provider and targets from another with no screen changes.

## 3. Capability model

```ts
type Capability = 'closes' | 'analystTargets' | 'earningsCalendar' | 'dividendCalendar';

interface Provider {
  id: string;
  capabilities: ReadonlySet<Capability>;
  getCloses?(ticker: string, from: IsoDate, to: IsoDate): Promise<DailyClose[]>;
  getAnalystTargets?(ticker: string): Promise<AnalystSnapshot>;
  getNextEarnings?(ticker: string): Promise<EarningsSnapshot>;
  getNextExDividend?(ticker: string): Promise<DividendSnapshot>;
}
```

- The **registry** maps each capability to an ordered list of active providers that advertise it. MVP: every capability resolves to `['yahoo']`.
- Each **screen** exposes `requiredCapabilities: Capability[]`. Before a run, the registry checks each screen; any screen with an unmet capability is disabled and the missing capability is reported in the UI.
- Interface is designed for capability **merging** across providers even though MVP has one provider. (Optional, non-blocking: a second prices-only adapter — e.g. Stooq — would prove merging end-to-end. Treat as polish.)

## 4. Storage (SQLite for MVP)

Append-only, as-of dated. Screens read the latest snapshot per instrument plus the price series.

```
instruments(
  ticker TEXT PRIMARY KEY,
  currency TEXT,
  state TEXT,               -- 'pending' | 'backfilling' | 'ready' | 'error'
  added_at TEXT,
  last_price_sync TEXT,
  last_metadata_sync TEXT
)

prices(
  ticker TEXT, date TEXT, close REAL,
  PRIMARY KEY (ticker, date)
)

analyst_snapshots(
  ticker TEXT, as_of TEXT,
  median_target REAL, num_analysts INTEGER,
  PRIMARY KEY (ticker, as_of)
)

earnings_snapshots(
  ticker TEXT, as_of TEXT, next_earnings_date TEXT,
  PRIMARY KEY (ticker, as_of)
)

dividend_snapshots(
  ticker TEXT, as_of TEXT, next_ex_div_date TEXT,
  PRIMARY KEY (ticker, as_of)
)
```

"Latest" metadata = row with `max(as_of)` for that ticker. Prior rows are retained for reproducibility/backtesting.

## 5. Metrics

### 5.1 Implied upside (base predicate input)

```
impliedUpside(ticker) = (medianTarget − latestClose) / latestClose
```

- `latestClose` = most recent row in `prices`. `medianTarget`, `numAnalysts` = latest `analyst_snapshots` row.
- **Quality gate:** ignore instruments with `numAnalysts < minAnalysts` (default 5) — a target from too few analysts does not qualify, in any screen.

### 5.2 Completed fluctuations (Category 1 metric)

Counts sharp directional swings in the trailing window using a **percentage ZigZag / directional-change algorithm** over **closing prices only** with a **single reversal threshold** `θ` (default 10%).

**Definition of one fluctuation:** a directional leg (up or down) that has **completed** — i.e. price has reversed ≥ `θ` from that leg's extreme, confirming the leg. Up-legs and down-legs count equally.

**Deliberate rule (your choice — flagged):** *"count only completed" means the final, still-unfolding leg is never counted, even if it has already moved past `θ`, because it has not yet been confirmed by a ≥`θ` reversal.* This slightly refines the earlier informal example (which ended on an un-reversed leg and counted it). The consistent behaviour is: **a leg counts only once the next reversal confirms it.** Consequence: a single monotonic run with no reversal counts as **0**. If you'd rather count a trailing leg the instant it crosses `θ`, that's a one-line change — but the spec below is confirm-on-reversal, per your decision.

**Reference algorithm:**
```
countCompletedFluctuations(closes, θ):        # closes: chronological, within lookback window
  if len(closes) < 2: return 0
  count = 0
  direction = 0            # 0 undetermined, +1 up, −1 down
  extreme = closes[0]      # running extreme of the current (pending) leg

  for price in closes[1:]:
    if direction == 0:
      change = (price − extreme) / extreme
      if change ≥ θ:        direction = +1; extreme = price
      elif change ≤ −θ:     direction = −1; extreme = price
      # (robust impl may seed the initial pivot at the first local extreme; negligible over 63 daily closes)
    elif direction == +1:
      if price > extreme:                       extreme = price          # extend up-leg
      elif (price − extreme) / extreme ≤ −θ:                              # ≥θ reversal down
        count += 1; direction = −1; extreme = price                      # up-leg CONFIRMED
    else: # direction == −1
      if price < extreme:                       extreme = price          # extend down-leg
      elif (price − extreme) / extreme ≥ θ:                               # ≥θ reversal up
        count += 1; direction = +1; extreme = price                      # down-leg CONFIRMED

  return count              # trailing pending leg intentionally excluded
```

**Mandatory acceptance tests (θ = 0.10):**

| Input closes                              | Expected | Why                                                        |
|-------------------------------------------|----------|------------------------------------------------------------|
| `[100,112,98,113,99,114]`                 | **4**    | four confirmed legs; trailing up-leg to 114 excluded       |
| `[100,110,121,133]`                       | **0**    | monotonic, never reverses ≥10% → nothing confirmed         |
| `[100,140,138,136]`                       | **0**    | one big up-move, no ≥10% reversal → not yet completed       |
| `[100,88,101,89,102,90,103]`              | **5**    | five confirmed alternating legs; trailing up-leg excluded  |
| `[100,103,97,104]`                        | **0**    | swings under 10% never confirm                             |

The `[100,112,98,113,99,114]` case is the canonical one: note the final `→114` is **+15% and still excluded** because no reversal confirms it. That is exactly the "count only completed" rule.

**Lookback:** run over closes within the trailing `lookbackTradingDays` (default 63 ≈ 3 months), configurable.

### 5.3 Event proximity (Categories 2 & 3)

```
daysToEvent = eventDate − today     # calendar days, upcoming only (eventDate ≥ today)
```
Past events do not qualify. Earnings and ex-dividend both use "upcoming within window" semantics.

## 6. Screens

All three share the **base predicate**:
```
BASE(ticker) := numAnalysts ≥ minAnalysts AND impliedUpside ≥ upsideThreshold
```
`upsideThreshold` is configurable **per screen** (your example used 40% for Category 1; default 20%).

| # | Screen                        | Predicate                                                       | Required capabilities                          |
|---|-------------------------------|----------------------------------------------------------------|------------------------------------------------|
| 1 | Volatile + undervalued        | `BASE AND completedFluctuations(θ, lookback) ≥ minOccurrences`  | `closes`, `analystTargets`                     |
| 2 | Pre-earnings + undervalued    | `BASE AND 0 ≤ daysToEarnings ≤ earningsWindowDays`             | `analystTargets`, `earningsCalendar`, `closes` |
| 3 | Pre-ex-dividend + undervalued | `BASE AND 0 ≤ daysToExDiv ≤ exDivWindowDays`                   | `analystTargets`, `dividendCalendar`, `closes` |

(`closes` is required everywhere because `latestClose` feeds `impliedUpside`.) Earnings is **upcoming-only** (front-running the event); post-earnings drift is explicitly a *separate future category*, not a tweak here.

## 7. Ingestion behaviour

**Instrument lifecycle:** `pending → backfilling → ready` (`error` on repeated adapter failure).

**Daily run:**
1. For each `ready` instrument: fetch only missing recent trading days (incremental); refresh metadata snapshots only if `metadataTtlDays` since `last_metadata_sync` has elapsed.
2. For each `pending`/`backfilling` instrument: continue backfilling toward `backfillLookbackDays` of history in throttled chunks; promote to `ready` once history covers `lookbackTradingDays`. A partial backfill is a valid state and resumes next run.
3. Sleep `interCallDelayMs` between provider calls throughout.

**Idempotency:** writing an existing `(ticker, date)` price or `(ticker, as_of)` snapshot is a no-op. A crashed run leaves consistent state and resumes cleanly.

**Cadence:** closes daily; metadata on `metadataTtlDays` TTL; one throttled run per day. Intended host: a scheduled GitHub Action (UTC cron, run well after US close; tolerate cron lag; dedupe by date so weekends/holidays add nothing).

## 8. Presentation (MVP)

A dashboard grouped by category. Each matched instrument shows the numbers behind the match, so the user can research — not just a ticker.

- **Category 1 row:** ticker, impliedUpside %, medianTarget, latestClose, numAnalysts, completedFluctuations count.
- **Category 2 row:** ticker, impliedUpside %, daysToEarnings, next earnings date, numAnalysts.
- **Category 3 row:** ticker, impliedUpside %, daysToExDiv, next ex-div date, numAnalysts.
- Disabled screens render a visible "unavailable — missing capability: X" state.
- Values shown in each instrument's **native currency** (no FX normalization in MVP).
- Framing throughout: research candidates, not recommendations.

No push alerts in MVP (later).

## 9. Configuration (defaults)

| Key                          | Default   | Scope        |
|------------------------------|-----------|--------------|
| `targetStatistic`            | `median`  | global       |
| `minAnalysts`                | `5`       | global       |
| `upsideThreshold`            | `0.20`    | per screen   |
| `fluctuation.swingPct` (θ)   | `0.10`    | Category 1   |
| `fluctuation.minOccurrences` | `4`       | Category 1   |
| `fluctuation.lookbackTradingDays` | `63` | Category 1   |
| `earnings.windowDays`        | `14`      | Category 2   |
| `exDividend.windowDays`      | `14`      | Category 3   |
| `backfillLookbackDays`       | `365`     | ingestion    |
| `metadataTtlDays`            | `7`       | ingestion    |
| `interCallDelayMs`           | `1500`    | ingestion    |

## 10. Out of scope for MVP

- Intraday / OHLC-based swing detection (closes only).
- FX normalization / multi-currency comparison.
- The "currently dipped" **dislocation** timing signal (drawdown-from-high / z-score) — parked for v2.
- Beta and market-index capability.
- Post-earnings-drift screen.
- Push/email alerts.
- Multi-provider capability merging in practice (interface supports it; only Yahoo ships). Optional Stooq prices adapter is the cheapest way to demo merging if desired.

## 11. Suggested stack and structure

- **Runtime:** Node + TypeScript. Ingestion is a CLI script suited to a scheduled GitHub Action.
- **Data source:** `yahoo-finance2`.
- **Storage:** SQLite (committed alongside the repo fits the Action pattern; swap behind the storage seam later).
- **Suggested layout:**
  ```
  /providers      adapters (yahoo.ts) + registry
  /storage        schema + repository (only stage that touches SQLite)
  /metrics        impliedUpside, completedFluctuations (+ their tests)
  /screens        category1..3, each declaring requiredCapabilities
  /ingest         backfill + daily refresh (state machine, throttling)
  /ui             dashboard
  /config         defaults + overrides
  ```
- Keep the five seams (§2.2 of the constitution) as real module boundaries: metrics and screens import from storage, never from providers.
