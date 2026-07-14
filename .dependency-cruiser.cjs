/**
 * Dependency-boundary rules (backlog item 004).
 *
 * Encodes the seam invariants of CONSTITUTION.md §2.2–2.3 as lint failures:
 * data flows ingestion → storage → metrics → screening → presentation, and
 * no stage reaches around another or at a provider directly.
 *
 * Monorepo layout: the pure domain lives in packages/core (types, config,
 * metrics, storage, screens), the worker library in packages/ingest
 * (providers, ingest), and the composition root + presentation in apps/web
 * (src/app, with _lib the composition glue and the pages the presentation).
 * Workspace dependencies already encode the coarse direction
 * (core ← ingest ← web); these rules keep the fine-grained seams.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "only-ingest-reaches-providers",
      comment:
        "metrics/, screens/, and storage/ must never import from providers/ " +
        "(CLAUDE.md guardrail 1). Everything downstream reads from storage. " +
        "The web pages (presentation) are held to the same bar by " +
        "web-pages-render-only.",
      severity: "error",
      from: {
        path: "^packages/core/src/(metrics|screens|storage)/",
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
        "roots (each app's src/app/, which construct one) may import a " +
        "repository module (SQLite or Postgres).",
      severity: "error",
      from: {
        path: "^(packages|apps)/",
        pathNot: "^(packages/core/src/storage|apps/[^/]+/src/app)/",
      },
      to: { path: "^packages/core/src/storage/(repository|postgres)" },
    },
    {
      name: "only-storage-touches-the-database",
      comment:
        "The storage repositories are the only code allowed to touch a " +
        "database engine — SQLite or Postgres (MVP.md §11, ADR-0011). " +
        "Driver ADAPTERS (pg.Pool/PGlite → SqlExecutor) live with the " +
        "composition root or tests, but repository/engine modules and the " +
        "engine libraries themselves stay behind storage/.",
      severity: "error",
      from: {
        pathNot: "^(packages/core/src/storage|apps/[^/]+/src/app)/",
      },
      to: {
        path: "better-sqlite3|node:sqlite|node_modules/pg/|@electric-sql/pglite",
      },
    },
    {
      name: "metrics-screens-are-pure",
      comment:
        "Metrics and screens are pure over stored data: no ingestion, no presentation, " +
        "no network or filesystem I/O (CONSTITUTION.md §2.2).",
      severity: "error",
      from: { path: "^packages/core/src/(metrics|screens)/" },
      to: {
        path: "^packages/ingest/src/ingest/|^(node:)?(fs|fs/promises|http|https|net|child_process)$",
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
        "Each app's src/app/ is a composition root (the one place that may " +
        "import both screens/ and providers/, and construct a repository); " +
        "nothing else may import either app's app dir — including " +
        "directories that don't exist yet (pathNot, not an allowlist).",
      severity: "error",
      from: { pathNot: "^apps/[^/]+/src/app/" },
      to: { path: "^apps/[^/]+/src/app/" },
    },
    {
      name: "web-pages-render-only",
      comment:
        "apps/web's route components (everything in src/app outside _lib " +
        "and api) are PRESENTATION: like the CLI's ui/, they render what " +
        "screening produced and must not reach storage, metrics, config, " +
        "ingestion, or providers directly (CONSTITUTION.md §2.2) — that is " +
        "the composition glue's job (_lib). Next.js forces pages to live " +
        "inside the app dir, so this rule re-creates the app/ vs ui/ split " +
        "the CLI gets from directories.",
      severity: "error",
      from: {
        path: "^apps/web/src/app/",
        pathNot: "^apps/web/src/app/(_lib|api)/",
      },
      to: {
        path: "^packages/core/src/(storage|metrics|config)/|^packages/ingest/src/|^(node:)?(fs|fs/promises|http|https|net|child_process)$",
      },
    },
    {
      name: "packages-do-not-import-apps",
      comment:
        "apps/web is the top of the graph: no library package may import " +
        "anything from an app (the workspace dependency direction is " +
        "core ← ingest ← web, never the reverse).",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "screens-feed-app-only",
      comment:
        "Screening sits above storage/metrics and below the composition root: " +
        "only a composition root (an app's src/app/, which includes the web " +
        "presentation Next.js forces to live there) may consume screens/. " +
        "Anything else importing a screen (e.g. ingestion pre-filtering by " +
        "screen predicates) inverts the one-directional flow " +
        "(CONSTITUTION.md §2.2).",
      severity: "error",
      from: {
        path: "^(packages|apps)/",
        pathNot: "^(apps/[^/]+/src/app|packages/core/src/screens)/",
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
      extensions: [".ts", ".tsx", ".js", ".json"],
    },
    // Tests and test-only fixture helpers sit outside the seam graph; our
    // packages' dist/ (and apps/web's .next/) is built output, not source.
    // The dist pattern is anchored to OUR workspace roots — a bare "/dist/"
    // would also match node_modules/<pkg>/dist/... and silently drop most
    // npm-package edges from the graph (which would blind the
    // engine-library rule above).
    exclude: {
      path: "\\.test\\.ts$|/src/test-support/|^(packages|apps)/[^/]+/dist/|^apps/[^/]+/\\.next/|^apps/web/next-env\\.d\\.ts$",
    },
  },
};
