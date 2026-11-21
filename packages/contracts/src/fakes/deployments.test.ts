import { deploymentStoreContract } from "../testing";
import { InMemoryDeploymentStore } from "./deployments";

deploymentStoreContract("in-memory", async () => new InMemoryDeploymentStore());
