import { pushSenderContract } from "../testing";
import { InMemoryPushSender } from "./push-sender";

pushSenderContract("in-memory", async (status) => {
  const sender = new InMemoryPushSender(status);
  return {
    sender,
    target: { endpoint: "https://push.example.com/s/1", keys: { p256dh: "p", auth: "a" } },
    delivered: () => sender.sent.length,
  };
});
