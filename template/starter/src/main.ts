import { createApp } from "./server.js";

// Cloud Run sets PORT; 8080 is its default and the Dockerfile's.
const port = Number(process.env.PORT ?? 8080);
const server = createApp();

server.listen(port, () => console.log(`listening on ${port}`));

// Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests, then exit.
process.on("SIGTERM", () => server.close(() => process.exit(0)));
