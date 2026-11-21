import { membershipStoreContract } from "../testing/membership";
import { InMemoryMembershipStore } from "./membership";

membershipStoreContract("in-memory", async () => new InMemoryMembershipStore());
