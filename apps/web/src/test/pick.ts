import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Picks an option in a Radix `Select` (AI-375: the ticket panel has no native select, so
 * `user.selectOptions` no longer applies): opens the combobox, then clicks the option by name.
 */
/** The option names a Radix `Select` offers: opens it, reads them, closes it with Escape. */
export async function optionsOf(user: UserEvent, combobox: HTMLElement): Promise<string[]> {
  await user.click(combobox);
  const listbox = await screen.findByRole("listbox");
  const names = [...listbox.querySelectorAll("[role=option]")].map(
    (o) => o.querySelector("span.flex > span")?.textContent?.trim() ?? o.textContent?.trim() ?? "",
  );
  await user.keyboard("{Escape}");
  return names;
}

export async function pick(user: UserEvent, combobox: HTMLElement, option: string | RegExp) {
  await user.click(combobox);
  await user.click(await screen.findByRole("option", { name: option }));
}
