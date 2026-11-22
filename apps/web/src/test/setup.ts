import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import { PAGE_LOAD } from "./timeouts";

// AI-219: every page test renders cold through the in-process API, and those renders are pure CPU
// (about 0.1 to 0.5 s alone). With other suites on the machine they passed testing-library's 1 s
// default in ~40 files, not only the first wait after a page opens. A missing element still fails,
// at 4 s instead of 1 s; no assertion changes.
configure({ asyncUtilTimeout: PAGE_LOAD.timeout });

// jsdom has no scrollTo; the router calls it on navigation.
if (typeof window !== "undefined") window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  // The remembered project scope (lib/scope.ts) must not leak between tests.
  if (typeof window !== "undefined") window.localStorage.clear();
});
