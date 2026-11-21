import { spendLedgerContract } from "../testing";
import { InMemorySpendLedger } from "./spend";

spendLedgerContract("in-memory", async () => new InMemorySpendLedger());
