import { digestSummaryStoreContract } from "../testing/digest-summary";
import { InMemoryDigestSummaryStore } from "./digest-summary";

digestSummaryStoreContract("in-memory", async () => new InMemoryDigestSummaryStore());
