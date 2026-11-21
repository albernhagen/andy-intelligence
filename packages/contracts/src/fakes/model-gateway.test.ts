import { modelGatewayContract } from "../testing";
import { InMemoryModelGateway } from "./model-gateway";

modelGatewayContract("in-memory", async (answer) => {
  const gateway = answer
    ? new InMemoryModelGateway(answer)
    : new InMemoryModelGateway(undefined, false);
  return { gateway, delivered: () => gateway.calls.length };
});
