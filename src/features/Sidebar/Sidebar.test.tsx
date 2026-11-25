import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createProject } from "../../lib/domain";
import type { WritingProject } from "../../lib/domain";
import { useWorkbench } from "../../lib/store";
import type { SaveStatus, WorkbenchView } from "../../lib/store";
import type { AuthorProfile } from "../../components/ProfilePage";
import { Sidebar } from "./Sidebar";
import { RightSidebar } from "./RightSidebar";
import { TopBar } from "./Topbar";

// The three bars are tested on their own, so the store is replaced with a mock.
jest.mock("../../lib/store", () => ({
  useWorkbench: jest.fn(),
}));

// The Backup/Export modals only need to prove the tool buttons open them, so they
// are replaced with stubs that can also be "closed" by firing their onClose.
jest.mock("../backup/BackupModal", () => ({
  BackupModal: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      MockBackup
    </button>
  ),
}));
jest.mock("../export/ExportModal", () => ({
  ExportModal: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      MockExport
    </button>
  ),
}));

const storeMock = jest.mocked(useWorkbench);
const setActiveViewMock = jest.fn<(view: WorkbenchView) => void>();
const retrySaveMock = jest.fn<() => void>();
const exportBackupMock = jest.fn<() => void>();

// The bars read a small slice of the store. Every field is defaulted so a test
// can override just what it needs.
function mockStore(overrides: {
  activeProject?: WritingProject | null;
  activeView?: WorkbenchView;
  saveStatus?: SaveStatus;
}) {
  storeMock.mockReturnValue({
    activeProject: overrides.activeProject ?? null,
    activeView: overrides.activeView ?? "projects",
    saveStatus: overrides.saveStatus ?? "saved",
    setActiveView: setActiveViewMock,
    retrySave: retrySaveMock,
    exportBackup: exportBackupMock,
  } as unknown as ReturnType<typeof useWorkbench>);
}

beforeEach(() => {
  setActiveViewMock.mockClear();
  retrySaveMock.mockClear();
  exportBackupMock.mockClear();
});

describe("Sidebar", () => {
  it("renders every navigation group, the tools and the bottom help item", () => {
    mockStore({});
    render(<Sidebar />);

    // Top-level and manuscript groups.
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("MANUSCRIPT")).toBeInTheDocument();
    for (const label of ["Story Structure", "Chapter Plan", "Characters", "Locations", "Events", "Timeline"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // Tools and bottom nav.
    expect(screen.getByText("TOOLS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backup & Restore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("marks the current view with the active class", () => {
    mockStore({ activeView: "characters" });
    render(<Sidebar />);

    expect(screen.getByRole("button", { name: "Characters" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "Projects" })).not.toHaveClass("active");
  });

  it("switches to the clicked view from a manuscript item and from the bottom nav", async () => {
    const user = userEvent.setup();
    mockStore({});
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "Timeline" }));
    expect(setActiveViewMock).toHaveBeenLastCalledWith("timeline");

    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(setActiveViewMock).toHaveBeenLastCalledWith("help");
  });

  it("collapses and expands: hides labels and group titles, then restores them", async () => {
    const user = userEvent.setup();
    mockStore({});
    render(<Sidebar />);

    // Expanded: brand text and group titles are visible.
    expect(screen.getByText("AUTHOR'S")).toBeInTheDocument();
    expect(screen.getByText("MANUSCRIPT")).toBeInTheDocument();

    // Collapse.
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.queryByText("AUTHOR'S")).not.toBeInTheDocument();
    expect(screen.queryByText("MANUSCRIPT")).not.toBeInTheDocument();
    expect(screen.queryByText("TOOLS")).not.toBeInTheDocument();
    // The collapse toggle switches to its expanded affordance.
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

    // Expand again.
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByText("AUTHOR'S")).toBeInTheDocument();
    expect(screen.getByText("MANUSCRIPT")).toBeInTheDocument();
  });

  it("opens the backup modal from the Backup & Restore tool and closes it via its onClose", async () => {
    const user = userEvent.setup();
    mockStore({});
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "Backup & Restore" }));
    expect(screen.getByRole("button", { name: "MockBackup" })).toBeInTheDocument();

    // The modal's onClose resets the open flag.
    await user.click(screen.getByRole("button", { name: "MockBackup" }));
    expect(screen.queryByRole("button", { name: "MockBackup" })).not.toBeInTheDocument();
  });

  it("opens the export modal from the Export tool and closes it via its onClose", async () => {
    const user = userEvent.setup();
    mockStore({});
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("button", { name: "MockExport" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "MockExport" }));
    expect(screen.queryByRole("button", { name: "MockExport" })).not.toBeInTheDocument();
  });
});

describe("RightSidebar — signature note", () => {
  it("renders the default signature and author", async () => {
    mockStore({ activeProject: null });
    render(<RightSidebar onOpenSource={jest.fn()} />);

    expect(
      await screen.findByText(
        "Stories are like secret drawers — full of things we forgot we knew."
      )
    ).toBeInTheDocument();

    expect(screen.getByText("— from your notebook")).toBeInTheDocument();
  });

  it("edits the signature on Enter and closes the textarea", async () => {
    const user = userEvent.setup();
    mockStore({ activeProject: null });
    render(<RightSidebar onOpenSource={jest.fn()} />);

    const signature = await screen.findByText(
      "Stories are like secret drawers — full of things we forgot we knew."
    );
    await user.dblClick(signature);
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "A new signature{Enter}");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("A new signature")).toBeInTheDocument();
  });

  it("keeps editing when Shift+Enter is pressed and closes on blur", async () => {
    const user = userEvent.setup();
    mockStore({ activeProject: null });
    render(<RightSidebar onOpenSource={jest.fn()} />);

    const signature = await screen.findByText(
      "Stories are like secret drawers — full of things we forgot we knew."
    );
    await user.dblClick(signature);
    const textarea = screen.getByRole("textbox");
    // Shift+Enter should NOT close the edit.
    await user.type(textarea, "{Shift>}{Enter}{/Shift}");
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // Losing focus closes it.
    await user.tab();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps the notebook attribution fixed when double-clicked", async () => {
    const user = userEvent.setup();
    mockStore({ activeProject: null });
    render(<RightSidebar onOpenSource={jest.fn()} />);

    await user.dblClick(screen.getByText("— from your notebook"));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("— from your notebook")).toBeInTheDocument();
  });

});

describe("RightSidebar — Story AI", () => {
  it("shows the assistant when a project is open", () => {
    const project = createProject({ title: "Novel", targetWordCount: 0, averageChapterLength: 0, storyStructure: "three-act" });
    mockStore({ activeProject: project });
    render(<RightSidebar onOpenSource={jest.fn()} />);
    expect(screen.getByRole("region", { name: "Story AI" })).toBeInTheDocument();
    expect(screen.queryByText("RECENTLY EDITED")).not.toBeInTheDocument();
  });
});

describe("TopBar", () => {
  function profile(overrides: Partial<AuthorProfile> = {}): AuthorProfile {
    return { displayName: "Imbi", penName: "Ink", bio: "", avatarUrl: null, ...overrides };
  }

  it("shows a default greeting and subtitle when no project is open", () => {
    mockStore({ activeProject: null });
    render(<TopBar profile={profile()} />);

    expect(screen.getByRole("heading", { name: "Hi, there!" })).toBeInTheDocument();
    expect(screen.getByText("Manage your writing projects and track your progress.")).toBeInTheDocument();
  });

  it("shows the open project's title and the writing prompt", () => {
    const project = createProject({ title: "My Novel", targetWordCount: 0, averageChapterLength: 0, storyStructure: "three-act" });
    mockStore({ activeProject: project });
    render(<TopBar profile={profile()} />);

    expect(screen.getByRole("heading", { name: "My Novel" })).toBeInTheDocument();
    expect(screen.getByText("Ready to write something wonderful today?")).toBeInTheDocument();
  });

  it.each<[SaveStatus, string]>([
    ["loading", "Loading…"],
    ["saving", "Saving…"],
    ["saved", "Saved locally"],
  ])("shows the %s save status badge", (status, label) => {
    mockStore({ activeProject: null, saveStatus: status });
    render(<TopBar profile={profile()} />);

    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the avatar initial when there is no avatar image", () => {
    mockStore({ activeProject: null });
    render(<TopBar profile={profile({ displayName: "Imbi" })} />);

    expect(screen.getByRole("button", { name: "Open profile" })).toHaveTextContent("I");
  });

  it("shows the fallback initial 'A' when the display name is blank", () => {
    mockStore({ activeProject: null });
    render(<TopBar profile={profile({ displayName: "   " })} />);

    expect(screen.getByRole("button", { name: "Open profile" })).toHaveTextContent("A");
  });

  it("shows an avatar image when avatarUrl is set", () => {
    mockStore({ activeProject: null });
    render(<TopBar profile={profile({ avatarUrl: "https://example.com/avatar.png" })} />);

    const avatar = screen.getByRole("button", { name: "Open profile" });
    expect(avatar.querySelector("img")).toHaveAttribute("src", "https://example.com/avatar.png");
    expect(avatar.querySelector("span")).toBeNull();
  });

  it("opens the profile page from the avatar button", async () => {
    const user = userEvent.setup();
    mockStore({ activeProject: null });
    render(<TopBar profile={profile()} />);

    await user.click(screen.getByRole("button", { name: "Open profile" }));
    expect(setActiveViewMock).toHaveBeenCalledWith("profile");
  });

  it("shows the error banner and triggers retry and export from it", async () => {
    const user = userEvent.setup();
    mockStore({ activeProject: null, saveStatus: "error" });
    render(<TopBar profile={profile()} />);

    // The badge switches to the failure label and the alert banner appears.
    expect(screen.getByRole("status")).toHaveTextContent("Save failed");
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Your latest changes haven't been saved.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retrySaveMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Export backup" }));
    expect(exportBackupMock).toHaveBeenCalledTimes(1);
  });
});
