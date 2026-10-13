import { BundleType, getBundleType, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { announceUpdateAvailable } from "../../features/settings/model/sounds";
import { rememberInstalledUpdate } from "./updateNotice";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export type UpdaterSnapshot = {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  error?: string;
  /** Set on Linux .deb/.rpm installs, which update through apt/dnf. */
  packageManaged?: PackageManagedInstall;
};

type AvailableUpdate = { version: string; body?: string | null };

let pendingUpdate: AvailableUpdate | null = null;
let downloadedVersion: string | null = null;
let restartPending = false;
let ownerWorkInFlight = 0;

/** Stops schedulers from claiming work while native update admission is closed. */
export function isUpdateRestartPending(): boolean {
  return restartPending;
}

export function setUpdateRestartPending(value: boolean): void {
  restartPending = value;
}

/**
 * Covers asynchronous owner preparation before it appears in a Session. A
 * restart probe rejects while this is held, so claiming a scheduled habit can
 * never silently consume its next run in the narrow pre-session gap.
 */
export function beginUpdateOwnerWork(): () => void {
  ownerWorkInFlight += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    ownerWorkInFlight = Math.max(0, ownerWorkInFlight - 1);
  };
}

export function hasUpdateOwnerWork(): boolean {
  return ownerWorkInFlight !== 0;
}

const RELEASES_URL =
  import.meta.env.VITE_MONOCODE_COMPANION_SPIKE === "1"
    ? "https://github.com/foleykyle01/monocode-mobile/releases"
    : "https://github.com/hardbeat920/monocode/releases/latest";

/**
 * Linux `.deb` and `.rpm` installs belong to apt/dnf. The release feed only
 * publishes an AppImage target, so the plugin reports no matching platform
 * for them; surface that as "update through your package manager" instead of
 * a raw error, and never self-install.
 */
export type PackageManagedInstall = "deb" | "rpm";

export async function packageManagedInstall(): Promise<PackageManagedInstall | null> {
  let type: string | null;
  try {
    type = await getBundleType();
  } catch {
    return null;
  }
  if (type === BundleType.Deb) return "deb";
  if (type === BundleType.Rpm) return "rpm";
  return null;
}

export function packageManagerHint(kind: PackageManagedInstall): string {
  return kind === "deb"
    ? `Download one .deb from ${RELEASES_URL} and run: sudo apt install ./MonoCode_X.Y.Z_amd64.deb\nReplace the file name with the one you downloaded.`
    : `Download one .rpm from ${RELEASES_URL} and run: sudo dnf install ./MonoCode-X.Y.Z-1.x86_64.rpm\nReplace the file name with the one you downloaded.`;
}

function isTargetMissingError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  // tauri-plugin-updater Error::TargetsNotFound / Error::TargetNotFound.
  return /none of the fallback platforms|the platform `[^`]*` was not found/i.test(
    text,
  );
}

function isUpdaterNotConfiguredError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /updater does not have any endpoints set/i.test(text);
}

export async function readAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

export async function probeForUpdate(): Promise<AvailableUpdate | null> {
  if (await packageManagedInstall()) {
    pendingUpdate = null;
    downloadedVersion = null;
    return null;
  }
  const update = await invoke<AvailableUpdate | null>("safe_update_check");
  pendingUpdate = update;
  if (update) announceUpdateAvailable(update.version);
  return update;
}

export async function runUpdateFlow(
  manual: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const currentVersion = await readAppVersion();
  const base: UpdaterSnapshot = { phase: "checking", currentVersion };
  onProgress?.(base);

  const managed = await packageManagedInstall();
  if (managed) {
    pendingUpdate = null;
    const idle: UpdaterSnapshot = {
      phase: "idle",
      currentVersion,
      packageManaged: managed,
    };
    onProgress?.(idle);
    if (manual) {
      await message(packageManagerHint(managed), {
        title: "MonoCode",
      });
    }
    return idle;
  }

  try {
    const update = await invoke<AvailableUpdate | null>("safe_update_check");
    if (!update) {
      pendingUpdate = null;
      downloadedVersion = null;
      const current: UpdaterSnapshot = { phase: "current", currentVersion };
      onProgress?.(current);
      if (manual) {
        await message("You're on the latest version.", { title: "MonoCode" });
      }
      return current;
    }

    pendingUpdate = update;
    announceUpdateAvailable(update.version);
    const available: UpdaterSnapshot = {
      phase: "available",
      currentVersion,
      availableVersion: update.version,
    };
    onProgress?.(available);

    if (!manual) return available;

    const notes = update.body?.trim();
    const detail = notes ? `\n\n${notes}` : "";
    const yes = await ask(
      `MonoCode ${update.version} is available (you have ${currentVersion}).${detail}\n\nDownload it now?`,
      { title: "Update available", kind: "info" },
    );
    if (!yes) return available;

    return installPendingUpdate(onProgress);
  } catch (err) {
    if (isUpdaterNotConfiguredError(err)) {
      pendingUpdate = null;
      const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
      onProgress?.(idle);
      if (manual) {
        await message(
          `Automatic updates aren't configured for this build.\n\nDownload releases at ${RELEASES_URL}`,
          { title: "MonoCode" },
        );
      }
      return idle;
    }

    if (isTargetMissingError(err)) {
      // The feed has no build for this platform/installer yet.
      pendingUpdate = null;
      const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
      onProgress?.(idle);
      if (manual) {
        await message(
          `Automatic updates aren't available for this install yet.\n\nDownload releases at ${RELEASES_URL}`,
          { title: "MonoCode" },
        );
      }
      return idle;
    }

    const error = err instanceof Error ? err.message : String(err);
    const failed: UpdaterSnapshot = { phase: "error", currentVersion, error };
    onProgress?.(failed);
    if (manual) {
      await message(`Couldn't check for updates.\n\n${error}`, {
        title: "MonoCode",
      });
    }
    return failed;
  }
}

export async function installPendingUpdate(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const currentVersion = await readAppVersion();
  const update = pendingUpdate;
  if (!update) {
    const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
    onProgress?.(idle);
    return idle;
  }

  try {
    if (downloadedVersion !== update.version) {
      onProgress?.({
        phase: "downloading",
        currentVersion,
        availableVersion: update.version,
        progress: 0,
      });
      let downloaded = 0;
      const unlisten = await listen<{ chunk?: number; total?: number }>(
        "monocode-update-download-progress",
        ({ payload }) => {
          downloaded += payload.chunk ?? 0;
          if (payload.total && payload.total > 0)
            onProgress?.({
              phase: "downloading",
              currentVersion,
              availableVersion: update.version,
              progress: Math.min(100, (100 * downloaded) / payload.total),
            });
        },
      ).catch(() => () => undefined);
      let result: { available: boolean; version?: string };
      try {
        result = await invoke<{ available: boolean; version?: string }>(
          "safe_update_download",
        );
      } finally {
        unlisten();
      }
      if (!result.available) {
        pendingUpdate = null;
        downloadedVersion = null;
        const current: UpdaterSnapshot = { phase: "current", currentVersion };
        onProgress?.(current);
        return current;
      }
      if (!result.version)
        throw new Error("The update download did not identify a version");
      if (result.version !== update.version) {
        // The feed changed after the initial check. Keep the new release
        // visible rather than incorrectly saying the app is current.
        pendingUpdate = { version: result.version };
        downloadedVersion = null;
        announceUpdateAvailable(result.version);
        const available: UpdaterSnapshot = {
          phase: "available",
          currentVersion,
          availableVersion: result.version,
        };
        onProgress?.(available);
        return available;
      }
      downloadedVersion = result.version;
    }

    const ready: UpdaterSnapshot = {
      phase: "ready",
      currentVersion,
      availableVersion: update.version,
    };
    onProgress?.(ready);
    const restart = await ask(
      `MonoCode ${update.version} is downloaded. Restart now to install it? You can choose Later and restart from this update row when work is clear.`,
      {
        title: "Update ready",
        kind: "info",
        okLabel: "Restart to update",
        cancelLabel: "Later",
      },
    );
    if (!restart) return ready;

    await invoke("safe_update_install_and_restart");
    rememberInstalledUpdate(update.version);
    pendingUpdate = null;
    downloadedVersion = null;
    return { phase: "current", currentVersion: update.version };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const failed: UpdaterSnapshot = {
      phase: "error",
      currentVersion,
      availableVersion: update.version,
      error,
    };
    onProgress?.(failed);
    await message(`Couldn't install the update.\n\n${error}`, {
      title: "MonoCode",
    });
    return failed;
  }
}
