import { routingConfigStoreContract } from "../testing";
import { InMemoryRoutingConfigStore } from "./routing";

routingConfigStoreContract("in-memory", async (now) => new InMemoryRoutingConfigStore(now));
