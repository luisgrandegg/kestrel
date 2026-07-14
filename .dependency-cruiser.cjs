/**
 * Dependency-boundary rules (backlog item 004).
 *
 * Encodes the seam invariants of CONSTITUTION.md §2.2–2.3 as lint failures:
 * data flows ingestion → storage → metrics → screening → presentation, and
 * no stage reaches around another or at a provider directly.
 *
 * Monorepo layout: the pure domain lives in packages/core (types, config,
 * metrics, storage, screens), the worker library in packages/ingest
 * (providers, ingest), and the composition root + presentation in apps/cli
 * (app, ui). Workspace dependencies already encode the coarse direction
 * (core ← ingest ← cli); these rules keep the fine-grained seams.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "only-ingest-reaches-providers",
      comment:
        "metrics/, screens/, storage/, and ui/ must never import from providers/ " +
        "(CLAUDE.md guardrail 1). Everything downstream reads from storage.",
      severity: "error",
      from: {
        path: "^(packages/core/src/(metrics|screens|storage)|apps/cli/src/ui)/",
      },
      to: { path: "^packages/ingest/src/providers/" },
    },
    {
      name: "no-provider-library-outside-providers",
      comment:
        "Only provider adapters may reference the underlying provider library " +
        "(yahoo-finance2). A provider quirk anywhere else is a bug (CONSTITUTION.md §2.3).",
      severity: "error",
      from: { pathNot: "^packages/ingest/src/providers/" },
      to: { path: "yahoo-finance2" },
    },
    {
      name: "port-not-driver",
      comment:
        "Consumers depend on the storage seam contract (storage/port), " +
        "never a concrete engine: only storage/ itself and the composition " +
        "root (apps/cli's app/, which constructs one) may import a " +
        "repository module (SQLite or Postgres).",
      severity: "error",
      from: {
        path: "^(packages|apps)/",
        pathNot: "^(packages/core/src/storage|apps/cli/src/app)/",
      },
      to: { path: "^packages/core/src/storage/(repository|postgres)" },
    },
    {
      name: "only-storage-touches-sqlite",
      comment:
        "The storage repository is the only code allowed to touch SQLite (MVP.md §11).",
      severity: "error",
      from: { pathNot: "^packages/core/src/storage/" },
      to: { path: "better-sqlite3|node:sqlite" },
    },
    {
      name: "metrics-screens-are-pure",
      comment:
        "Metrics and screens are pure over stored data: no ingestion, no presentation, " +
        "no network or filesystem I/O (CONSTITUTION.md §2.2).",
      severity: "error",
      from: { path: "^packages/core/src/(metrics|screens)/" },
      to: {
        path: "^packages/ingest/src/ingest/|^apps/cli/src/ui/|^(node:)?(fs|fs/promises|http|https|net|child_process)$",
      },
    },
    {
      name: "ui-renders-only",
      comment:
        "Presentation renders what screening produced — nothing else. It may " +
        "import only screens/ (result shapes) and types/: reading storage, " +
        "metrics, or config from ui/ would reach around screening and put " +
        "judgement in presentation (CONSTITUTION.md §2.2); no I/O either.",
      severity: "error",
      from: { path: "^apps/cli/src/ui/" },
      to: {
        path: "^(packages|apps)/|^(node:)?(fs|fs/promises|http|https|net|child_process)$",
        pathNot: "^packages/core/src/(screens|types)/|^apps/cli/src/ui/",
      },
    },
    {
      name: "types-are-leaf",
      comment:
        "types/ is the shared pure leaf every layer may import: it must " +
        "import nothing itself, so pure layers can never reach I/O through it.",
      severity: "error",
      from: { path: "^packages/core/src/types/" },
      to: {},
    },
    {
      name: "app-is-top",
      comment:
        "app/ is the composition root (the one place that may import " +
        "both screens/ and providers/); nothing else may import it — " +
        "including directories that don't exist yet (pathNot, not an allowlist).",
      severity: "error",
      from: { pathNot: "^apps/cli/src/app/" },
      to: { path: "^apps/cli/src/app/" },
    },
    {
      name: "packages-do-not-import-apps",
      comment:
        "apps/cli is the top of the graph: no library package may import " +
        "anything from an app (the workspace dependency direction is " +
        "core ← ingest ← cli, never the reverse).",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "screens-feed-app-and-ui-only",
      comment:
        "Screening sits above storage/metrics and below the composition root " +
        "and presentation: only app/ and ui/ may consume screens/. Anything " +
        "else importing a screen (e.g. ingestion pre-filtering by screen " +
        "predicates) inverts the one-directional flow (CONSTITUTION.md §2.2).",
      severity: "error",
      from: {
        path: "^(packages|apps)/",
        pathNot: "^(apps/cli/src/(app|ui)|packages/core/src/screens)/",
      },
      to: { path: "^packages/core/src/screens/" },
    },
    {
      name: "no-circular",
      comment:
        "Seams are one-directional; cycles mean a seam has been breached.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      comment:
        "Every import must resolve. Without this, a forbidden cross-package " +
        "import written as an @kestrel/... specifier from a package that " +
        "does not declare the dependency is UNRESOLVABLE — it matches no " +
        "path-keyed seam rule above and the boundary lint silently passes " +
        "(the violation then only surfaces as an unrelated-looking TS2307).",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    // Resolve the workspace packages' source-consumed exports (package.json
    // "exports" targets pointing at .ts sources) so cross-package edges land
    // on their real packages/... paths and the seam rules above match them.
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "require", "node", "default"],
      extensions: [".ts", ".js", ".json"],
    },
    // Tests and test-only fixture helpers sit outside the seam graph;
    // dist/ is built output, not source.
    exclude: { path: "\\.test\\.ts$|/src/test-support/|/dist/" },
  },
};
