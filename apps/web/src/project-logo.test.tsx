import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/**
 * AI-393: every project has a mark wherever it is named: its logo as an `<img>` from a data URL,
 * or its key on a tile. Settings → Logo uploads (SVG or PNG) through the API's sanitizer and
 * removes it.
 */

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1"/></svg>';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function withProject(path: string, logo?: string) {
  const h = renderApp(path);
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  if (logo) {
    const updatedAt = "2026-11-26T10:00:00.000Z";
    await h.projectLogos.put({
      projectId: "ai",
      format: "svg",
      data: logo,
      updatedAt,
      updatedBy: "user:andy",
    });
    await h.tracker.updateProject("ai", { logoUpdatedAt: updatedAt });
  }
  await h.queryClient.invalidateQueries();
  return h;
}

const logoSection = async (h: Awaited<ReturnType<typeof withProject>>) => {
  const nav = await screen.findByRole("navigation", { name: "Settings sections" });
  await h.user.click(within(nav).getByRole("link", { name: "Logo" }));
  return within(await screen.findByRole("region", { name: "Logo" }));
};

afterEach(() => window.localStorage.clear());

describe("project mark", () => {
  it("GivenNoLogo_WhenTheSidebarShowsTheProject_ThenItsKeyTileShows", async () => {
    await withProject("/p/ai");
    const projects = await screen.findByRole("navigation", { name: "Projects" });
    const link = await within(projects).findByRole("link", { name: /Andy Intelligence/ });
    expect(link.querySelector("[data-project-key-tile]")?.textContent).toBe("AI");
    expect(link.querySelector("img")).toBeNull();
  });

  it("GivenAStoredLogo_WhenTheSidebarShowsTheProject_ThenItIsAnImgFromADataUrlNeverInline", async () => {
    await withProject("/p/ai", SVG);
    const projects = await screen.findByRole("navigation", { name: "Projects" });
    const link = await within(projects).findByRole("link", { name: /Andy Intelligence/ });
    await waitFor(() => expect(link.querySelector("img[data-project-logo]")).not.toBeNull());
    const img = link.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`,
    );
    expect(document.querySelector('path[d="M1 1"]')).toBeNull();
  });
});

describe("Settings → Logo", () => {
  it("GivenNoLogo_WhenAndyUploadsAnSvg_ThenItIsStoredSanitizedAndPreviewed", async () => {
    const h = await withProject("/p/ai/settings");
    const section = await logoSection(h);
    const file = new File([SVG.replace("<path", "<metadata>m</metadata><path")], "logo.svg", {
      type: "image/svg+xml",
    });

    await h.user.upload(section.getByLabelText("Logo"), file);

    expect(await section.findByRole("img", { name: "Andy Intelligence logo" })).toBeTruthy();
    expect((await h.projectLogos.get("ai"))?.data).toBe(SVG);
    expect(await section.findByText("Saved")).toBeTruthy();
  });

  it("GivenAnSvgWithAScript_WhenUploaded_ThenTheApiReasonShowsAndNothingIsStored", async () => {
    const h = await withProject("/p/ai/settings");
    const section = await logoSection(h);
    const file = new File([SVG.replace("<path", "<script>alert(1)</script><path")], "x.svg", {
      type: "image/svg+xml",
    });

    await h.user.upload(section.getByLabelText("Logo"), file);

    expect((await section.findByRole("alert")).textContent).toContain(
      "the SVG has a <script> element, which is not allowed",
    );
    expect(await h.projectLogos.get("ai")).toBeNull();
  });

  it("GivenAPng_WhenUploaded_ThenItIsStoredAsBase64", async () => {
    const h = await withProject("/p/ai/settings");
    const section = await logoSection(h);

    await h.user.upload(
      section.getByLabelText("Logo"),
      new File([PNG], "logo.png", { type: "image/png" }),
    );

    await waitFor(async () => expect((await h.projectLogos.get("ai"))?.format).toBe("png"));
    expect((await h.projectLogos.get("ai"))?.data).toBe(btoa(String.fromCharCode(...PNG)));
  });

  it("GivenAGif_WhenPicked_ThenTheBrowserRefusesItBeforeSending", async () => {
    const h = await withProject("/p/ai/settings");
    const section = await logoSection(h);

    // Past the input's `accept` filter, as a drag-and-drop or another browser could be.
    fireEvent.change(section.getByLabelText("Logo"), {
      target: { files: [new File(["GIF89a"], "logo.gif", { type: "image/gif" })] },
    });

    expect((await section.findByRole("alert")).textContent).toBe(
      "only SVG and PNG files can be a logo",
    );
  });

  it("GivenAStoredLogo_WhenAndyRemovesIt_ThenTheKeyTileIsBack", async () => {
    const h = await withProject("/p/ai/settings", SVG);
    const section = await logoSection(h);

    await h.user.click(await section.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(section.queryByRole("img")).toBeNull());
    expect(await h.projectLogos.get("ai")).toBeNull();
    expect((await h.tracker.getProject("ai"))?.logoUpdatedAt).toBeNull();
  });
});
