import type { Category1Match } from "@kestrel/core/screens/category1";
import type { Category2Match } from "@kestrel/core/screens/category2";
import type { Category3Match } from "@kestrel/core/screens/category3";
import type { IsoDate, ScreenEvaluation } from "@kestrel/core/types";

/**
 * Dashboard renderer (backlog item 018) — MVP.md §8, CONSTITUTION.md §2.2.
 *
 * Pure presentation: screen results in, text out. No business logic — no
 * thresholds, no predicates, no metric computation, no I/O; it renders
 * exactly what screening produced. Disabled screens are shown with their
 * missing capabilities, never hidden (guardrail 4). Prices render in each
 * instrument's native currency, unconverted (§10 keeps FX out of scope);
 * an instrument whose currency has not been reported yet renders an
 * explicit "?" rather than an unlabeled number.
 */

export interface DashboardInput {
  asOf: IsoDate;
  category1: ScreenEvaluation<Category1Match>;
  category2: ScreenEvaluation<Category2Match>;
  category3: ScreenEvaluation<Category3Match>;
}

export function renderDashboard(input: DashboardInput): string {
  const lines: string[] = [
    `Kestrel — research candidates as of ${input.asOf}`,
    "Candidates for further research, not recommendations. Prices in each instrument's native currency.",
    "",
    ...section("Category 1 — volatile + undervalued", input.category1, {
      headers: [
        "ticker",
        "upside",
        "median target",
        "latest close",
        "analysts",
        "fluctuations",
      ],
      row: (m) => [
        m.ticker,
        percent(m.impliedUpside),
        money(m.medianTarget, m.currency),
        money(m.latestClose, m.currency),
        String(m.numAnalysts),
        String(m.completedFluctuations),
      ],
    }),
    "",
    ...section("Category 2 — pre-earnings + undervalued", input.category2, {
      headers: [
        "ticker",
        "upside",
        "days to earnings",
        "earnings date",
        "analysts",
      ],
      row: (m) => [
        m.ticker,
        percent(m.impliedUpside),
        String(m.daysToEarnings),
        m.nextEarningsDate,
        String(m.numAnalysts),
      ],
    }),
    "",
    ...section("Category 3 — pre-ex-dividend + undervalued", input.category3, {
      headers: [
        "ticker",
        "upside",
        "days to ex-div",
        "ex-div date",
        "analysts",
      ],
      row: (m) => [
        m.ticker,
        percent(m.impliedUpside),
        String(m.daysToExDiv),
        m.nextExDivDate,
        String(m.numAnalysts),
      ],
    }),
  ];
  return `${lines.join("\n")}\n`;
}

interface SectionSpec<Match> {
  headers: readonly string[];
  row(match: Match): string[];
}

function section<Match>(
  title: string,
  evaluation: ScreenEvaluation<Match>,
  spec: SectionSpec<Match>,
): string[] {
  if (!evaluation.resolution.enabled) {
    const missing = evaluation.resolution.missing.join(", ");
    return [title, `  unavailable — missing capability: ${missing}`];
  }
  if (evaluation.matches.length === 0) {
    return [title, "  no matches"];
  }
  return [title, ...table(spec.headers, evaluation.matches.map(spec.row))];
}

/** Fixed-width text table, sized to the widest cell per column. */
function table(headers: readonly string[], rows: string[][]): string[] {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const render = (cells: readonly string[]): string =>
    `  ${cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")}`.trimEnd();
  return [render(headers), ...rows.map(render)];
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Native-currency price; "?" when no provider has reported a currency. */
function money(value: number, currency: string | null): string {
  return `${value.toFixed(2)} ${currency ?? "?"}`;
}
