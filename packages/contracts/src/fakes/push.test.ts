import { pushSubscriptionStoreContract } from "../testing";
import { InMemoryPushSubscriptionStore } from "./push";

pushSubscriptionStoreContract("in-memory", async () => new InMemoryPushSubscriptionStore());
