import { spendNoticeLedgerContract } from "../testing";
import { InMemorySpendNoticeLedger } from "./spend-notices";

spendNoticeLedgerContract("in-memory", async () => new InMemorySpendNoticeLedger());
