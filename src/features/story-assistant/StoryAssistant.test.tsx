import "../../test/indexedDbSetup";
import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import { getAll, writeChanges } from "../../lib/db";
import type { WritingProject } from "../../lib/domain";
import { buildProject } from "../../test/fixtures";
import { checkRules, storySources } from "./consistency";
import { basicOutline, prepareImport } from "./outline";

beforeEach(async () => {
  const projects = await getAll<WritingProject>("projects");
  await writeChanges("projects", [], projects.map(({ id }) => id));
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "LanguageModel");
  jest.restoreAllMocks();
});

function modelResponse(output: unknown) {
  Object.defineProperty(globalThis, "LanguageModel", {
    configurable: true,
    value: { availability: async () => "available", create: async () => ({
      prompt: async () => JSON.stringify(output), destroy: jest.fn(),
    }) },
  });
}

async function openProject(project: WritingProject) {
  await writeChanges("projects", [project], []);
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Start writing" }));
  await user.click(await screen.findByRole("button", { name: "Open project" }));
  return { user, assistant: within(screen.getByRole("region", { name: "Story AI" })) };
}

it("reports date and location rules without assuming precision from partial dates", () => {
  const project = buildProject();
  const date = { year: 1980, month: 2, day: 29 };
  project.locations.push({ id: "l2", name: "Forest" });
  project.scenes = [
    { ...project.scenes[0], date, time: "12:00", locationId: "l1" },
    { ...project.scenes[0], id: "s2", date, time: "12:00", locationId: "l2" },
  ];
  project.characters[0].birthday = { year: 1980, month: 3 };
  const findings = checkRules(project);
  expect(findings.filter(({ message }) => message.includes("before their birth"))).toHaveLength(2);
  expect(findings.find(({ message }) => message.includes("same recorded time"))?.sources.map(({ source }) => source.id))
    .toEqual(["s1", "s2", "c1", "l1", "l2"]);

  project.characters[0].birthday = { year: 1980 };
  project.scenes[1].date = { year: 1980, month: 2 };
  expect(checkRules(project)).toEqual([]);
});

it("shows rule and evidenced semantic findings and focuses their exact record", async () => {
  const project = buildProject();
  project.events[0].startDate = { year: 1970 };
  project.events[0].endDate = { year: 1971 };
  project.characters[1].description = "Bob was born at sea.";
  const sources = storySources(project);
  const bob = sources.findIndex(({ id }) => id === "c2");
  const storm = sources.findIndex(({ id }) => id === "e1");
  modelResponse([
    { message: "Review Bob’s timeline.", evidence: [{ index: bob, quote: "Bob was born at sea." }, { index: storm, quote: "A storm hits." }] },
    { message: "Unsupported finding", evidence: [{ index: bob, quote: "made-up quote" }, { index: storm, quote: "A storm hits." }] },
  ]);
  const { assistant, user } = await openProject(project);
  await user.click(assistant.getByRole("button", { name: "Check consistency" }));
  expect(await assistant.findByText(/1 rule findings · 1 semantic suggestions/)).toBeVisible();
  expect(assistant.queryByText("Unsupported finding")).not.toBeInTheDocument();
  const [event] = assistant.getAllByRole("button", { name: "event: The storm" });
  await user.click(event);
  expect(document.getElementById("story-source-event-e1")).toHaveFocus();
  const [character] = assistant.getAllByRole("button", { name: "character: Bob" });
  await user.click(character);
  expect(document.getElementById("story-source-character-c2")).toHaveFocus();
});

it("answers a project question with a clickable source", async () => {
  const project = buildProject();
  const index = storySources(project).findIndex(({ id }) => id === "s1");
  modelResponse({ answer: "The confrontation is at the dock.", evidence: [{ index, quote: "Dock fight" }] });
  const { assistant, user } = await openProject(project);
  await user.click(assistant.getByRole("button", { name: "Chat" }));
  await user.type(assistant.getByRole("textbox", { name: "Ask about your project" }), "Where is the fight?");
  await user.click(assistant.getByRole("button", { name: "Send" }));
  expect(await assistant.findByText("The confrontation is at the dock.")).toBeVisible();
  await user.click(assistant.getByRole("button", { name: "scene: Dock fight" }));
  expect(document.getElementById("story-source-scene-s1")).toHaveFocus();
});

it("builds basic drafts while requiring real dates for new records", () => {
  const project = buildProject();
  const rows = basicOutline(project, "角色：Alice、梅\n2020-02-29 Alice 在港口遇见梅。");
  expect(rows.map(({ kind }) => kind)).toEqual(["character", "character", "event", "scene"]);
  expect(rows[0].match).toBe("c1");
  expect(() => prepareImport(project, rows)).toThrow(/birth date for 梅/);
  rows[1].date = "1993";
  const result = prepareImport(project, rows);
  expect(result.events[0].startDate).toEqual({ year: 2020, month: 2, day: 29 });
  expect(result.scenes[0].eventId).toBe(result.events[0].id);
  expect(result.scenes[0].characterIds).toEqual(["c1", result.characters[0].id]);
});

it("previews outline drafts and imports matched characters and linked records only after confirmation", async () => {
  const prototype = HTMLDialogElement.prototype;
  if (!prototype.showModal) {
    Object.defineProperties(prototype, {
      showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
    });
  }
  const fields = { description: "", date: "", end: "", characters: [], chapter: "", location: "", event: "" };
  modelResponse([
    { ...fields, kind: "character", title: "Alice" },
    { ...fields, kind: "character", title: "Mei", date: "1991" },
    { ...fields, kind: "event", title: "New arrival", date: "2020-01", characters: ["Alice", "Mei"], chapter: "Chapter 1", location: "Harbour" },
    { ...fields, kind: "scene", title: "Mei arrives", date: "2020-01-04", characters: ["Mei"], event: "New arrival" },
  ]);
  const { assistant, user } = await openProject(buildProject());
  await user.click(assistant.getByRole("button", { name: "Outline" }));
  await user.type(assistant.getByRole("textbox", { name: "Paste your outline" }), "Alice meets Mei at the harbour.");
  await user.click(assistant.getByRole("button", { name: "Draft from outline" }));
  await user.click(await assistant.findByRole("button", { name: "Review 4 drafts" }));
  let dialog = within(screen.getByRole("dialog", { name: "Review outline drafts" }));
  expect(dialog.getAllByRole("combobox", { name: "Character match" })[0]).toHaveValue("c1");
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect((await getAll<WritingProject>("projects"))[0].characters).toHaveLength(3);
  await user.click(assistant.getByRole("button", { name: "Review 4 drafts" }));
  dialog = within(screen.getByRole("dialog", { name: "Review outline drafts" }));
  await user.click(dialog.getByRole("button", { name: "Confirm import" }));
  await waitFor(async () => {
    const [saved] = await getAll<WritingProject>("projects");
    expect(saved.characters.filter(({ name }) => name === "Alice")).toHaveLength(1);
    const mei = saved.characters.find(({ name }) => name === "Mei");
    const event = saved.events.find(({ title }) => title === "New arrival");
    expect(event?.characterIds).toEqual(["c1", mei?.id]);
    expect(event?.chapterIds).toEqual(["ch1"]);
    const scene = saved.scenes.find(({ title }) => title === "Mei arrives");
    expect(scene?.eventId).toBe(event?.id);
    expect(scene?.characterIds).toEqual([mei?.id]);
  }, { timeout: 3000 });
});
