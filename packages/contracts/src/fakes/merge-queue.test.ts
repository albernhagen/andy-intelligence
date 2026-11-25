import { mergeQueueStoreContract } from "../testing";
import { InMemoryMergeQueueStore } from "./merge-queue";

mergeQueueStoreContract("in-memory", async () => new InMemoryMergeQueueStore());
