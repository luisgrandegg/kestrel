import { describeRepositoryContract } from "../test-support/repositoryContract.js";
import { Repository } from "./repository.js";

/**
 * SQLite engine run of the shared StorageRepository contract suite
 * (../test-support/repositoryContract.ts) — every case goes through the
 * port; the Postgres engine runs the identical suite in ./postgres.test.ts.
 */
describeRepositoryContract("sqlite", async () => new Repository(":memory:"));
