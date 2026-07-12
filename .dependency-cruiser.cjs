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
        "Presentation contains no business logic and no fetching: it may not import " +
        "ingestion or providers (CONSTITUTION.md §2.2).",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { path: "^src/(ingest|providers)/" },
    },
    {
      name: "no-circular",
      comment: "Seams are one-directional; cycles mean a seam has been breached.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "\\.test\\.ts$" },
  },
};
