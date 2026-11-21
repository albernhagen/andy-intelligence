// Every MCP tool module, one line each, sorted by file name (AI-145). A module exports a
// `ToolGroup` (`registerXTools(server, deps, run)`) and gets one line here; `tools.test.ts` fails
// when a `tools-*.ts` file is missing. Order is not significant: tool names are unique.
export { registerBriefTools as brief } from "./tools-brief";
export { registerConfigTools as config } from "./tools-config";
export { registerConfigLogTools as configLog } from "./tools-config-log";
export { registerCoreTools as core } from "./tools-core";
export { registerDigestTools as digest } from "./tools-digest";
export { registerDispatchTools as dispatch } from "./tools-dispatch";
export { registerExecutorTools as executor } from "./tools-executor";
export { registerHistoryTools as history } from "./tools-history";
export { registerIdeateTools as ideate } from "./tools-ideate";
export { registerInFlightTools as inFlight } from "./tools-inflight";
export { registerMilestoneMapTools as milestoneMap } from "./tools-milestone-map";
export { registerNightTools as night } from "./tools-night";
export { registerNotifyTools as notify } from "./tools-notify";
export { registerProjectPlanTools as projectPlan } from "./tools-project-plan";
export { registerProjectTools as projects } from "./tools-projects";
export { registerQuotaTools as quota } from "./tools-quota";
export { registerRoutingTools as routing } from "./tools-routing";
export { registerScoreTools as scores } from "./tools-scores";
export { registerSettingsTools as settings } from "./tools-settings";
export { registerSpendTools as spend } from "./tools-spend";
export { registerTicketTools as tickets } from "./tools-tickets";
export { registerWhatsNewTools as whatsNew } from "./tools-whats-new";
export { registerWorkTools as work } from "./tools-work";
export { registerWorkerTools as worker } from "./tools-worker";
