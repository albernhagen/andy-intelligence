import { notifyFlushQueueContract, notifyLedgerContract } from "../testing";
import { InMemoryNotifyFlushQueue, InMemoryNotifyLedger } from "./notify-email";

notifyLedgerContract("in-memory", async () => new InMemoryNotifyLedger());
notifyFlushQueueContract("in-memory", async () => new InMemoryNotifyFlushQueue());
