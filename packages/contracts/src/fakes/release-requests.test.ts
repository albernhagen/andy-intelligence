import { releaseRequestStoreContract } from "../testing";
import { InMemoryReleaseRequestStore } from "./release-requests";

releaseRequestStoreContract("in-memory", async () => new InMemoryReleaseRequestStore());
