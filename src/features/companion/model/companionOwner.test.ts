import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
import { registerCompanionOwner } from "./companionOwner";

afterEach(() => vi.restoreAllMocks());

it("reclaims after the original owner closes without starting the network host", async () => {
  let ready!: () => void;
  let reclaim!: () => void;
  const controlReady = new Promise<void>(resolve => { ready = resolve; });
  mocks.listen.mockImplementation(async (_event, callback) => {
    reclaim = callback;
    return mocks.unlisten;
  });
  mocks.invoke.mockReset().mockRejectedValueOnce(new Error("Another window owns access")).mockResolvedValue(undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const dispose = registerCompanionOwner(controlReady);
  await Promise.resolve();
  expect(mocks.invoke).not.toHaveBeenCalled();
  ready();
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  reclaim();
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  expect(mocks.invoke.mock.calls).toEqual([["companion_enable"], ["companion_enable"]]);
  dispose();
  reclaim();
  await Promise.resolve();
  expect(mocks.unlisten).toHaveBeenCalledOnce();
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});

it("does not claim if the workspace closes before its listeners are ready", async () => {
  let ready!: () => void;
  mocks.invoke.mockReset();
  mocks.listen.mockResolvedValue(mocks.unlisten);
  const dispose = registerCompanionOwner(new Promise<void>(resolve => { ready = resolve; }));
  dispose();
  ready();
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
