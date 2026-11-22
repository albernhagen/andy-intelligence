/**
 * Testing-library's wait for `findBy*` and `waitFor` in web tests (AI-219), set as the default in
 * `setup.ts`. Page renders run cold through the in-process API: 0.1 to 0.5 s alone, but past the
 * library's 1 s default when several suites share the CPU (parallel sessions pushing at once).
 * It stays under the 15 s test timeout, so a real failure still names the missing element.
 */
export const PAGE_LOAD = { timeout: 4000 } as const;
