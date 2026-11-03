import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no scrollTo; the router calls it on navigation.
if (typeof window !== "undefined") window.scrollTo = () => {};

afterEach(cleanup);
