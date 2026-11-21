// Routes registered after the /api sign-in and body-limit middleware: every /api/* path gets
// it; the others here (MCP, OAuth) check their own caller and are allow-listed in
// `registries.test.ts`. One line per module, sorted by module
// path (AI-145): a module exports `apiRoutes: RouteModule` and gets one line here. Order is not
// significant: `routes.test.ts` proves no two routes can match the same request.
export { apiRoutes as board } from "./board";
export { apiRoutes as brief } from "./brief";
export { apiRoutes as configChanges } from "./config-changes";
export { apiRoutes as configProposals } from "./config-proposals";
export { apiRoutes as dashboard } from "./dashboard";
export { apiRoutes as digest } from "./digest";
export { apiRoutes as dora } from "./dora";
export { apiRoutes as epics } from "./epics";
export { apiRoutes as githubSetup } from "./github/setup";
export { apiRoutes as ideate } from "./ideate";
export { apiRoutes as inFlight } from "./in-flight";
export { apiRoutes as mcp } from "./mcp";
export { apiRoutes as night } from "./night";
export { apiRoutes as notify } from "./notify";
export { apiRoutes as projectPlan } from "./project-plan";
export { apiRoutes as quota } from "./quota";
export { apiRoutes as routing } from "./routing";
export { apiRoutes as runners } from "./runners";
export { apiRoutes as runs } from "./runs";
export { apiRoutes as setup } from "./setup";
export { apiRoutes as tickets } from "./tickets";
export { apiRoutes as work } from "./work";
