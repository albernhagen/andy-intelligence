import { epicBreakdownStoreContract } from "../testing/epic-breakdown-store";
import { InMemoryEpicBreakdownStore } from "./epic-breakdown-store";

epicBreakdownStoreContract("in-memory", async () => new InMemoryEpicBreakdownStore());
