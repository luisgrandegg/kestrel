import type { KestrelConfig } from "@kestrel/core/config";
import { makeCategory1Screen } from "@kestrel/core/screens/category1";
import { makeCategory2Screen } from "@kestrel/core/screens/category2";
import { makeCategory3Screen } from "@kestrel/core/screens/category3";
import type { StorageRepository } from "@kestrel/core/storage/port";
import type { Capability, IsoDate } from "@kestrel/core/types";
import type { ProviderRegistry } from "@kestrel/ingest/providers/registry";
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
