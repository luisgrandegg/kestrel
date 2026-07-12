import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, loadConfig, resolveConfig } from "./index.js";

describe("defaultConfig", () => {
  it("matches the MVP.md §9 defaults exactly", () => {
    expect(defaultConfig).toEqual({
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
      },
    });
  });

  it("is deeply frozen", () => {
    expect(() => {
      (defaultConfig as { minAnalysts: number }).minAnalysts = 1;
    }).toThrow(TypeError);
    expect(() => {
      (defaultConfig.fluctuation as { swingPct: number }).swingPct = 0.5;
    }).toThrow(TypeError);
  });
});

describe("resolveConfig", () => {
  it("returns the defaults when no overrides are given", () => {
    expect(resolveConfig()).toEqual(defaultConfig);
  });

  it("merges a top-level override without touching other keys", () => {
    const config = resolveConfig({ minAnalysts: 3 });
    expect(config.minAnalysts).toBe(3);
    expect(config.fluctuation).toEqual(defaultConfig.fluctuation);
    expect(config.screens).toEqual(defaultConfig.screens);
  });

  it("overrides upsideThreshold per screen, other screens keep the default", () => {
    const config = resolveConfig({
      screens: { category1: { upsideThreshold: 0.4 } },
    });
    expect(config.screens.category1.upsideThreshold).toBe(0.4);
    expect(config.screens.category2.upsideThreshold).toBe(0.2);
    expect(config.screens.category3.upsideThreshold).toBe(0.2);
  });

  it("merges nested overrides without dropping sibling keys", () => {
    const config = resolveConfig({ fluctuation: { minOccurrences: 6 } });
    expect(config.fluctuation.minOccurrences).toBe(6);
    expect(config.fluctuation.swingPct).toBe(0.1);
    expect(config.fluctuation.lookbackTradingDays).toBe(63);
  });

  it("does not mutate the defaults", () => {
    resolveConfig({ minAnalysts: 3 });
    expect(defaultConfig.minAnalysts).toBe(5);
  });

  it("rejects unknown keys instead of ignoring them", () => {
    expect(() => resolveConfig({ minAnalyst: 3 } as never)).toThrow(
      /Unknown config key: "minAnalyst"/,
    );
    expect(() =>
      resolveConfig({ fluctuation: { swing: 0.2 } } as never),
    ).toThrow(/Unknown config key: "fluctuation.swing"/);
  });

  it("rejects an object where a primitive is expected, and vice versa", () => {
    expect(() => resolveConfig({ minAnalysts: {} } as never)).toThrow(
      /must be a primitive/,
    );
    expect(() => resolveConfig({ fluctuation: 0.1 } as never)).toThrow(
      /must be an object/,
    );
  });

  it("rejects invalid values loudly", () => {
    expect(() => resolveConfig({ minAnalysts: -1 })).toThrow(
      /"minAnalysts" must be a non-negative integer/,
    );
    expect(() => resolveConfig({ minAnalysts: 2.5 })).toThrow(
      /"minAnalysts" must be a non-negative integer/,
    );
    expect(() => resolveConfig({ fluctuation: { swingPct: 0 } })).toThrow(
      /"fluctuation.swingPct" must be a positive finite number/,
    );
    expect(() =>
      resolveConfig({
        screens: { category2: { upsideThreshold: Number.NaN } },
      }),
    ).toThrow(
      /"screens.category2.upsideThreshold" must be a positive finite number/,
    );
    expect(() => resolveConfig({ targetStatistic: "mean" as never })).toThrow(
      /targetStatistic must be "median"/,
    );
  });
});

describe("loadConfig", () => {
  const tempDir = () => mkdtempSync(join(tmpdir(), "kestrel-config-"));

  it("merges a JSON override file over the defaults", () => {
    const path = join(tempDir(), "kestrel.config.json");
    writeFileSync(
      path,
      JSON.stringify({
        minAnalysts: 8,
        screens: { category1: { upsideThreshold: 0.4 } },
      }),
    );
    const config = loadConfig(path);
    expect(config.minAnalysts).toBe(8);
    expect(config.screens.category1.upsideThreshold).toBe(0.4);
    expect(config.screens.category2.upsideThreshold).toBe(0.2);
    expect(config.ingestion).toEqual(defaultConfig.ingestion);
  });

  it("throws when an explicitly passed file is missing", () => {
    expect(() => loadConfig(join(tempDir(), "missing.json"))).toThrow(
      /Config file not readable/,
    );
  });

  it("throws on invalid JSON", () => {
    const path = join(tempDir(), "kestrel.config.json");
    writeFileSync(path, "{ not json");
    expect(() => loadConfig(path)).toThrow(/not valid JSON/);
  });

  it("throws when the file does not contain an object", () => {
    const path = join(tempDir(), "kestrel.config.json");
    writeFileSync(path, JSON.stringify([1, 2, 3]));
    expect(() => loadConfig(path)).toThrow(/must contain a JSON object/);
  });
});
