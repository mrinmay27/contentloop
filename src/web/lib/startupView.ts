/**
 * Which screen the app shows before the main UI is usable.
 *
 * This exists because "no pages" and "couldn't load pages" used to be the same
 * state (an empty `pages` array), so both rendered an eternal "Loading pages…"
 * spinner: a fresh install dead-ended before the user could create anything,
 * and a failed fetch gave no clue what went wrong. Keeping the decision in one
 * pure function makes those three cases impossible to conflate again.
 */

export type StartupStatus = "loading" | "ready" | "error";
export type StartupView = "loading" | "error" | "welcome" | "app";

export function resolveStartupView(input: {
  status: StartupStatus;
  pageCount: number;
}): StartupView {
  if (input.status === "loading") return "loading";
  // Error outranks the empty case deliberately: if the API is unreachable we
  // must not invite the user to create a page that cannot be saved.
  if (input.status === "error") return "error";
  return input.pageCount === 0 ? "welcome" : "app";
}
