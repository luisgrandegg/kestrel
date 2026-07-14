/**
 * Dependency-boundary rules (backlog item 004).
 *
 * Encodes the seam invariants of CONSTITUTION.md §2.2–2.3 as lint failures:
 * data flows ingestion → storage → metrics → screening → presentation, and
 * no stage reaches around another or at a provider directly.
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
      from: { path: "^src/(metrics|screens|storage|ui)/" },
      to: { path: "^src/providers/" },
    },
    {
      name: "no-provider-library-outside-providers",
      comment:
        "Only provider adapters may reference the underlying provider library " +
        "(yahoo-finance2). A provider quirk anywhere else is a bug (CONSTITUTION.md §2.3).",
      severity: "error",
      from: { pathNot: "^src/providers/" },
      to: { path: "yahoo-finance2" },
    },
    {
      name: "port-not-driver",
      comment:
        "Consumers depend on the storage seam contract (storage/port), " +
        "never a concrete driver: only storage/ itself and the composition " +
        "root (app/, which constructs one) may import the repository module.",
      severity: "error",
      from: {
        path: "^src/",
        pathNot: "^src/(storage|app)/",
      },
      to: { path: "^src/storage/repository" },
    },
    {
      name: "only-storage-touches-sqlite",
      comment:
        "The storage repository is the only code allowed to touch SQLite (MVP.md §11).",
      severity: "error",
      from: { pathNot: "^src/storage/" },
      to: { path: "better-sqlite3|node:sqlite" },
    },
    {
      name: "metrics-screens-are-pure",
      comment:
        "Metrics and screens are pure over stored data: no ingestion, no presentation, " +
        "no network or filesystem I/O (CONSTITUTION.md §2.2).",
      severity: "error",
      from: { path: "^src/(metrics|screens)/" },
      to: {
        path: "^src/(ingest|ui)/|^(node:)?(fs|fs/promises|http|https|net|child_process)$",
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
      from: { path: "^src/ui/" },
      to: {
        path: "^src/|^(node:)?(fs|fs/promises|http|https|net|child_process)$",
        pathNot: "^src/(screens|types|ui)/",
      },
    },
    {
      name: "types-are-leaf",
      comment:
        "src/types/ is the shared pure leaf every layer may import: it must " +
        "import nothing itself, so pure layers can never reach I/O through it.",
      severity: "error",
      from: { path: "^src/types/" },
      to: {},
    },
    {
      name: "app-is-top",
      comment:
        "src/app/ is the composition root (the one place that may import " +
        "both screens/ and providers/); nothing else may import it — " +
        "including directories that don't exist yet (pathNot, not an allowlist).",
      severity: "error",
      from: {
        path: "^src/",
        pathNot: "^src/app/",
      },
      to: { path: "^src/app/" },
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
        path: "^src/",
        pathNot: "^src/(app|ui|screens)/",
      },
      to: { path: "^src/screens/" },
    },
    {
      name: "no-circular",
      comment:
        "Seams are one-directional; cycles mean a seam has been breached.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    // Tests and test-only fixture helpers sit outside the seam graph.
    exclude: { path: "\\.test\\.ts$|^src/test-support/" },
  },
};
