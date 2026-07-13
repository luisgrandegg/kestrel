import { readFileSync } from "node:fs";

/**
 * Configuration module (backlog item 002).
 *
 * Every judgement-encoding threshold lives here with the MVP.md §9 defaults
 * (CONSTITUTION.md §4: parameters with sensible defaults, never hardcoded
 * constants). Overrides are merged over the defaults — from a plain object or
 * a JSON file — so no code change is needed to adjust a threshold.
 */

export type TargetStatistic = "median";

export interface ScreenConfig {
  /** Minimum implied upside for the base predicate, per screen. */
  upsideThreshold: number;
}

export interface FluctuationConfig {
  /** Reversal threshold θ for the percentage-ZigZag algorithm. */
  swingPct: number;
  /** Minimum completed fluctuations for a Category 1 match. */
  minOccurrences: number;
  /** Trailing window of closes the metric runs over. */
  lookbackTradingDays: number;
}

export interface EventWindowConfig {
  /** Upcoming-event window in calendar days. */
  windowDays: number;
}

export interface IngestionConfig {
  backfillLookbackDays: number;
  metadataTtlDays: number;
  interCallDelayMs: number;
  /**
   * Consecutive adapter failures before an instrument is marked `error`.
   * Required by MVP.md §7 ("error on repeated adapter failure") though §9
   * lists no key for it — added here rather than hardcoded (guardrail 5).
   * The default of 3 is a provisional gap-fill pending user sign-off
   * (recorded on backlog item 011).
   */
  maxConsecutiveFailures: number;
}

export interface KestrelConfig {
  targetStatistic: TargetStatistic;
  /** Quality gate: instruments with fewer analysts never qualify. */
  minAnalysts: number;
  screens: {
    /** Category 1: volatile + undervalued. */
    category1: ScreenConfig;
    /** Category 2: pre-earnings + undervalued. */
    category2: ScreenConfig;
    /** Category 3: pre-ex-dividend + undervalued. */
    category3: ScreenConfig;
  };
  fluctuation: FluctuationConfig;
  earnings: EventWindowConfig;
  exDividend: EventWindowConfig;
  ingestion: IngestionConfig;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type ConfigOverrides = DeepPartial<KestrelConfig>;

/** MVP.md §9 defaults, verbatim. */
export const defaultConfig: KestrelConfig = deepFreeze({
  targetStatistic: "median",
  minAnalysts: 5,
  screens: {
    category1: { upsideThreshold: 0.2 },
    category2: { upsideThreshold: 0.2 },
    category3: { upsideThreshold: 0.2 },
  },
  fluctuation: {
    swingPct: 0.1,
    minOccurrences: 4,
    lookbackTradingDays: 63,
  },
  earnings: { windowDays: 14 },
  exDividend: { windowDays: 14 },
  ingestion: {
    backfillLookbackDays: 365,
    metadataTtlDays: 7,
    interCallDelayMs: 1500,
    maxConsecutiveFailures: 3,
  },
});

/**
 * Resolved against process.cwd(): intended for repo-root invocation. Note
 * the sharp edge: with the implicit default path, a missing file silently
 * means "no overrides" — runners started elsewhere should pass explicit
 * paths (backlog 019).
 */
export const DEFAULT_CONFIG_PATH = "kestrel.config.json";

/** Merge overrides over the defaults. Unknown keys and bad values throw. */
export function resolveConfig(overrides: ConfigOverrides = {}): KestrelConfig {
  const merged = mergeInto(
    defaultConfig as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>,
    "",
  ) as unknown as KestrelConfig;
  validateConfig(merged);
  return merged;
}

/**
 * Load config from a JSON override file merged over the defaults.
 * (The read/parse ladder mirrors loadWatchlist in src/ingest — keep their
 * error-wrapping styles in sync.)
 *
 * With no argument, the default path is optional: absence means "no
 * overrides". An explicitly passed path must exist — a typo'd path failing
 * silently would present default thresholds as the user's own.
 */
export function loadConfig(filePath?: string): KestrelConfig {
  const path = filePath ?? DEFAULT_CONFIG_PATH;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (
      filePath === undefined &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return resolveConfig();
    }
    throw new Error(`Config file not readable: ${path}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Config file is not valid JSON: ${path}`, { cause: error });
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Config file must contain a JSON object: ${path}`);
  }
  return resolveConfig(parsed as ConfigOverrides);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeInto(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    if (!(key in base)) {
      throw new Error(`Unknown config key: "${path}${key}"`);
    }
    const baseValue = base[key];
    if (isPlainObject(baseValue)) {
      if (!isPlainObject(value)) {
        throw new Error(
          `Config key "${path}${key}" must be an object, got: ${JSON.stringify(value)}`,
        );
      }
      out[key] = mergeInto(baseValue, value, `${path}${key}.`);
    } else {
      if (isPlainObject(value)) {
        throw new Error(
          `Config key "${path}${key}" must be a primitive, got an object`,
        );
      }
      out[key] = value;
    }
  }
  return out;
}

function validateConfig(config: KestrelConfig): void {
  if (config.targetStatistic !== "median") {
    throw new Error(
      `targetStatistic must be "median" in the MVP, got: ${JSON.stringify(config.targetStatistic)}`,
    );
  }
  const nonNegativeIntegers: Array<[string, unknown]> = [
    ["minAnalysts", config.minAnalysts],
    ["fluctuation.minOccurrences", config.fluctuation.minOccurrences],
    ["earnings.windowDays", config.earnings.windowDays],
    ["exDividend.windowDays", config.exDividend.windowDays],
    ["ingestion.backfillLookbackDays", config.ingestion.backfillLookbackDays],
    ["ingestion.metadataTtlDays", config.ingestion.metadataTtlDays],
    ["ingestion.interCallDelayMs", config.ingestion.interCallDelayMs],
  ];
  for (const [key, value] of nonNegativeIntegers) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error(
        `Config key "${key}" must be a non-negative integer, got: ${JSON.stringify(value)}`,
      );
    }
  }
  // The fluctuation metric needs at least 2 closes to ever count anything,
  // and ingestion promotes instruments to "ready" once history covers this
  // window — 0/1 would silently disable Category 1 (CONSTITUTION.md §6).
  const lookback = config.fluctuation.lookbackTradingDays;
  if (
    typeof lookback !== "number" ||
    !Number.isInteger(lookback) ||
    lookback < 2
  ) {
    throw new Error(
      `Config key "fluctuation.lookbackTradingDays" must be an integer >= 2, got: ${JSON.stringify(lookback)}`,
    );
  }
  // 0 would mark instruments error before any failure is tolerated.
  const maxFailures = config.ingestion.maxConsecutiveFailures;
  if (
    typeof maxFailures !== "number" ||
    !Number.isInteger(maxFailures) ||
    maxFailures < 1
  ) {
    throw new Error(
      `Config key "ingestion.maxConsecutiveFailures" must be a positive integer, got: ${JSON.stringify(maxFailures)}`,
    );
  }
  // θ is a ratio: 0.10 means 10%. θ >= 1 can never be confirmed by positive
  // prices, so the metric would silently count 0 for every series.
  const swing = config.fluctuation.swingPct;
  if (
    typeof swing !== "number" ||
    !Number.isFinite(swing) ||
    swing <= 0 ||
    swing >= 1
  ) {
    throw new Error(
      `Config key "fluctuation.swingPct" must be a ratio in (0, 1) — e.g. 0.1 for 10% — got: ${JSON.stringify(swing)}`,
    );
  }
  const positiveRatios: Array<[string, unknown]> = [
    [
      "screens.category1.upsideThreshold",
      config.screens.category1.upsideThreshold,
    ],
    [
      "screens.category2.upsideThreshold",
      config.screens.category2.upsideThreshold,
    ],
    [
      "screens.category3.upsideThreshold",
      config.screens.category3.upsideThreshold,
    ],
  ];
  for (const [key, value] of positiveRatios) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Config key "${key}" must be a positive finite number, got: ${JSON.stringify(value)}`,
      );
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (isPlainObject(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
