import { nightLaunchStoreContract } from "../testing";
import { InMemoryNightLaunchStore } from "./night";

nightLaunchStoreContract("in-memory", async () => new InMemoryNightLaunchStore());
