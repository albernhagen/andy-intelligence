import { milestoneStoreContract } from "../testing/milestone-store";
import { InMemoryMilestoneStore } from "./milestone-store";

milestoneStoreContract("in-memory", async () => new InMemoryMilestoneStore());
