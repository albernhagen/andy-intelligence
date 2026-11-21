import { spendCapsStoreContract } from "../testing";
import { InMemorySpendCapsStore } from "./spend-caps";

spendCapsStoreContract("in-memory", async (now) => new InMemorySpendCapsStore(now));
