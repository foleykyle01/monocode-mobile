import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getVersion, getBundleType, invoke, message, ask } = vi.hoisted(() => ({
  getVersion: vi.fn(),
  getBundleType: vi.fn(),
  invoke: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion,
  getBundleType,
  BundleType: {
    Nsis: "nsis",
    Msi: "msi",
    Deb: "deb",
    Rpm: "rpm",
    AppImage: "appimage",
    App: "app",
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask, message }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../features/settings/model/sounds", () => ({
  announceUpdateAvailable: vi.fn(),
}));

import { packageManagerHint, probeForUpdate, runUpdateFlow } from "./updater";

describe("updater", () => {
  beforeEach(() => {
    getBundleType.mockResolvedValue("appimage");
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps automatic checks quiet when updater endpoints are missing", async () => {
    getVersion.mockResolvedValue("0.1.23");
    invoke.mockRejectedValue(
      new Error("Updater does not have any endpoints set"),
    );

    await expect(runUpdateFlow(false)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    });
    expect(message).not.toHaveBeenCalled();
  });

  it("points manual checks without updater endpoints to GitHub releases", async () => {
    getVersion.mockResolvedValue("0.1.23");
    invoke.mockRejectedValue(
      new Error("Updater does not have any endpoints set"),
    );

    await expect(runUpdateFlow(true)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    });
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://github.com/hardbeat920/monocode/releases/latest",
      ),
      { title: "MonoCode" },
    );
  });

  it("still reports real updater failures", async () => {
    getVersion.mockResolvedValue("0.1.23");
    invoke.mockRejectedValue(new Error("network failed"));

    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "error",
      error: "network failed",
    });
    expect(message).toHaveBeenCalledOnce();
  });

  it("keeps the companion's manual fallback on its own release channel", async () => {
    vi.stubEnv("VITE_MONOCODE_COMPANION_SPIKE", "1");
    vi.resetModules();
    getVersion.mockResolvedValue("0.13.0");
    invoke.mockRejectedValue(
      new Error("Updater does not have any endpoints set"),
    );
    const companionUpdater = await import("./updater");

    await companionUpdater.runUpdateFlow(true);

    expect(message).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://github.com/foleykyle01/monocode-mobile/releases",
      ),
      { title: "MonoCode" },
    );
  });

  it.each(["deb", "rpm"] as const)(
    "names one %s installer and the releases URL",
    (kind) => {
      const hint = packageManagerHint(kind);
      expect(hint).toContain(
        "https://github.com/hardbeat920/monocode/releases/latest",
      );
      expect(hint).not.toMatch(/[*<>]/);
      expect(hint).toContain("Replace the file name");
      expect(hint).toContain(
        kind === "deb"
          ? "sudo apt install ./MonoCode_X.Y.Z_amd64.deb"
          : "sudo dnf install ./MonoCode-X.Y.Z-1.x86_64.rpm",
      );
    },
  );

  it.each([
    ["deb", "sudo apt install"],
    ["rpm", "sudo dnf install"],
  ])(
    "sends %s installs to their package manager without checking the feed",
    async (kind, hint) => {
      getVersion.mockResolvedValue("0.9.0");
      getBundleType.mockResolvedValue(kind);

      await expect(runUpdateFlow(true)).resolves.toEqual({
        phase: "idle",
        currentVersion: "0.9.0",
        packageManaged: kind,
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(message).toHaveBeenCalledWith(expect.stringContaining(hint), {
        title: "MonoCode",
      });
    },
  );

  it("keeps the automatic probe silent on package-managed installs", async () => {
    getBundleType.mockResolvedValue("deb");

    await expect(probeForUpdate()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still checks the feed for AppImage installs", async () => {
    getVersion.mockResolvedValue("0.9.0");
    invoke.mockResolvedValue(null);

    await expect(runUpdateFlow(false)).resolves.toEqual({
      phase: "current",
      currentVersion: "0.9.0",
    });
    expect(invoke).toHaveBeenCalledWith("safe_update_check");
  });

  it("treats a feed without this platform as unavailable, not as a failure", async () => {
    getVersion.mockResolvedValue("0.9.0");
    invoke.mockRejectedValue(
      new Error(
        'None of the fallback platforms `["linux-x86_64-deb", "linux-x86_64"]` were found in the response `platforms` object',
      ),
    );

    await expect(runUpdateFlow(true)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.9.0",
    });
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("aren't available for this install yet"),
      { title: "MonoCode" },
    );
  });
});
