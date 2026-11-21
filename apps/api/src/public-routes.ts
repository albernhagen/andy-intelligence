// Public routes: registered before the /api sign-in middleware, so each must check its own
// caller (OIDC token, HMAC signature or runner secret). One line per module, sorted by module path
// (AI-145). Adding one is an entry point: update docs/security/threat-model.md in the same PR.
export { publicRoutes as deployments } from "./deployments";
export { publicRoutes as githubToken } from "./github/token";
export { publicRoutes as githubWebhooks } from "./github/webhooks";
export { publicRoutes as notify } from "./notify";
export { publicRoutes as reviewFindings } from "./review-findings";
export { publicRoutes as runners } from "./runners";
export { publicRoutes as runs } from "./runs";
export { publicRoutes as watchdog } from "./watchdog";
