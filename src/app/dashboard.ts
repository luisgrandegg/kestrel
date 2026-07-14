import type { KestrelConfig } from "../config/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { makeCategory1Screen } from "../screens/category1.js";
import { makeCategory2Screen } from "../screens/category2.js";
import { makeCategory3Screen } from "../screens/category3.js";
import type { StorageRepository } from "../storage/port.js";
import type { Capability, IsoDate } from "../types/index.js";
import { renderDashboard } from "../ui/dashboard.js";
import { buildSnapshots, evaluateScreen } from "./evaluateScreens.js";

/**
 * Storage → screens → presentation, end to end (M6 Definition of Done):
 * evaluate the three MVP screens over one set of as-of-bounded snapshots
 * and render the result. This is the composition-root step item 019's
 * scheduled run will call after ingestion.
 */
export async function buildDashboard(
  repo: StorageRepository,
  registry: ProviderRegistry,
  config: KestrelConfig,
  asOf: IsoDate,
): Promise<string> {
  const category1 = makeCategory1Screen(config);
  const category2 = makeCategory2Screen(config);
  const category3 = makeCategory3Screen(config);

  const anyEnabled = [category1, category2, category3].some(
    (screen: { requiredCapabilities: readonly Capability[] }) =>
      registry.resolveScreen(screen.requiredCapabilities).enabled,
  );
  const snapshots = anyEnabled ? await buildSnapshots(repo, config, asOf) : [];

  return renderDashboard({
    asOf,
    category1: evaluateScreen(snapshots, registry, category1),
    category2: evaluateScreen(snapshots, registry, category2),
    category3: evaluateScreen(snapshots, registry, category3),
  });
}
