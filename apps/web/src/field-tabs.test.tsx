import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** AI-368: Field wires label, help, error and saved cue to its control; Tabs move by arrow keys. */

describe("Field", () => {
  it("GivenHelp_WhenRendered_ThenTheLabelNamesTheControlAndTheHelpDescribesIt", () => {
    render(
      <Field label="Name" help="Shown on the board.">
        <Input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Name" });
    const help = screen.getByText("Shown on the board.");
    expect(input.getAttribute("aria-describedby")).toBe(help.id);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("GivenAnError_WhenRendered_ThenTheControlIsInvalidAndTheMessageIsAnnounced", () => {
    render(
      <Field label="Name" help="Shown on the board." error="Name is taken." saved>
        <Input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Name" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Name is taken.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
    // A failed write never also reads as saved.
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("GivenASavedWrite_WhenRendered_ThenTheSavedCueShowsInALiveRegion", () => {
    render(
      <Field label="Auto-refine" saved="Saved · 2:50 PM">
        <Switch />
      </Field>,
    );

    const cue = screen.getByText("Saved · 2:50 PM");
    const live = cue.closest("[aria-live=polite]");
    expect(live).not.toBeNull();
    expect(live?.className).toContain("text-success");
    expect(screen.getByRole("switch", { name: "Auto-refine" })).toBeTruthy();
  });
});

describe("Tabs", () => {
  function Example() {
    return (
      <Tabs defaultValue="general">
        <TabsList aria-label="Settings">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
        </TabsList>
        <TabsContent value="general">General settings</TabsContent>
        <TabsContent value="models">Model routing</TabsContent>
      </Tabs>
    );
  }

  it("GivenTheActiveTab_WhenArrowRightIsPressed_ThenTheNextTabAndItsPanelShow", async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "General" }));
    await user.keyboard("{ArrowRight}");

    const models = screen.getByRole("tab", { name: "Models" });
    expect(document.activeElement).toBe(models);
    expect(models.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Model routing");
  });

  it("GivenATab_WhenRendered_ThenItHasAFocusRingAPhoneTargetAndTheSelectedState", () => {
    render(<Example />);
    const cls = screen.getByRole("tab", { name: "General" }).className;

    expect(cls).toContain("focus-visible:outline-ring");
    expect(cls).toContain("h-11");
    expect(cls).toContain("data-[state=active]:bg-selected");
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}|rgb\(|oklch\(|dark:/i);
  });
});
