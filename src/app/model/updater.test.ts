import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  getVersion: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  remember: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mocks.getVersion,
  getBundleType: vi.fn().mockResolvedValue("appimage"),
  BundleType: {
    Nsis: "nsis",
    Msi: "msi",
    Deb: "deb",
    Rpm: "rpm",
    AppImage: "appimage",
    App: "app",
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: mocks.ask,
  message: mocks.message,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../features/settings/model/sounds", () => ({
  announceUpdateAvailable: mocks.announce,
}));
vi.mock("./updateNotice", () => ({ rememberInstalledUpdate: mocks.remember }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.getVersion.mockResolvedValue("0.1.22");
  mocks.message.mockResolvedValue(undefined);
  mocks.ask.mockResolvedValue(true);
  mocks.listen.mockResolvedValue(vi.fn());
});

async function updaterWithPendingUpdate() {
  mocks.invoke.mockResolvedValueOnce({ version: "0.1.23" });
  const updater = await import("./updater");
  await updater.probeForUpdate();
  return updater;
}

describe("installPendingUpdate", () => {
  it("downloads through native code before recording the gated restart", async () => {
    const updater = await updaterWithPendingUpdate();
    mocks.invoke
      .mockResolvedValueOnce({ available: true, version: "0.1.23" })
      .mockResolvedValueOnce(undefined);

    await updater.installPendingUpdate();

    expect(mocks.remember).toHaveBeenCalledWith("0.1.23");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "safe_update_download");
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      "safe_update_install_and_restart",
    );
  });

  it("does not record when the native restart gate rejects active work", async () => {
    const updater = await updaterWithPendingUpdate();
    mocks.invoke
      .mockResolvedValueOnce({ available: true, version: "0.1.23" })
      .mockRejectedValueOnce(new Error("active work"));

    const result = await updater.installPendingUpdate();

    expect(result.phase).toBe("error");
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("keeps a downloaded update ready when the user chooses Later", async () => {
    const updater = await updaterWithPendingUpdate();
    mocks.invoke.mockResolvedValueOnce({ available: true, version: "0.1.23" });
    mocks.ask.mockResolvedValue(false);

    await expect(updater.installPendingUpdate()).resolves.toMatchObject({
      phase: "ready",
    });
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "safe_update_install_and_restart",
    );
  });

  it("does nothing when no update is pending", async () => {
    const updater = await import("./updater");

    expect((await updater.installPendingUpdate()).phase).toBe("idle");
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("reuses the verified download after Later and reports a newly published version", async () => {
    const updater = await updaterWithPendingUpdate();
    mocks.invoke.mockResolvedValueOnce({ available: true, version: "0.1.24" });
    expect((await updater.installPendingUpdate()).phase).toBe("available");
    expect(mocks.ask).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValueOnce({ available: true, version: "0.1.24" });
    mocks.ask.mockResolvedValueOnce(false);
    expect((await updater.installPendingUpdate()).phase).toBe("ready");
    mocks.ask.mockResolvedValueOnce(true);
    mocks.invoke.mockResolvedValueOnce(undefined);
    await updater.installPendingUpdate();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "safe_update_download")).toHaveLength(2);
    expect(mocks.remember).toHaveBeenCalledWith("0.1.24");
  });

  it("removes its progress listener when downloading fails", async () => {
    const updater = await updaterWithPendingUpdate();
    const unlisten = vi.fn();
    mocks.listen.mockResolvedValueOnce(unlisten);
    mocks.invoke.mockRejectedValueOnce(new Error("download interrupted"));
    expect((await updater.installPendingUpdate()).phase).toBe("error");
    expect(unlisten).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalledWith("safe_update_install_and_restart");
  });
});
