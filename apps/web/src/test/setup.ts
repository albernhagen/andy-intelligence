import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no scrollTo; the router calls it on navigation.
if (typeof window !== "undefined") window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  // The remembered project scope (lib/scope.ts) must not leak between tests.
  if (typeof window !== "undefined") window.localStorage.clear();
});
