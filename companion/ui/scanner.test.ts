import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPermissions, requestPermissions, scan, Format } from "@tauri-apps/plugin-barcode-scanner";
import { scanPairingTicket, scannerErrorMessage } from "./scanner";

vi.mock("@tauri-apps/plugin-barcode-scanner", () => ({
  checkPermissions: vi.fn(), requestPermissions: vi.fn(), scan: vi.fn(), Format: { QRCode: "QR_CODE" },
}));

describe("pairing camera", () => {
  beforeEach(() => vi.resetAllMocks());

  it("waits for the first permission response before opening the camera", async () => {
    vi.mocked(checkPermissions).mockResolvedValue("prompt");
    let grant!: (value: "granted") => void;
    vi.mocked(requestPermissions).mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    vi.mocked(scan).mockResolvedValue({ content: "ticket", format: Format.QRCode });
    const result = scanPairingTicket();
    await vi.waitFor(() => expect(requestPermissions).toHaveBeenCalledOnce());
    expect(scan).not.toHaveBeenCalled();
    grant("granted");
    await expect(result).resolves.toBe("ticket");
    expect(scan).toHaveBeenCalledOnce();
  });

  it("does not open the camera after permission is denied", async () => {
    vi.mocked(checkPermissions).mockResolvedValue("prompt");
    vi.mocked(requestPermissions).mockResolvedValue("denied");
    await expect(scanPairingTicket()).rejects.toThrow("Enable Camera");
    expect(scan).not.toHaveBeenCalled();
  });

  it("does not ask again when camera access is already granted", async () => {
    vi.mocked(checkPermissions).mockResolvedValue("granted");
    vi.mocked(scan).mockResolvedValue({ content: "ticket", format: Format.QRCode });
    await expect(scanPairingTicket()).resolves.toBe("ticket");
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it("preserves native error details instead of misreporting cancellation", () => {
    expect(scannerErrorMessage("Camera permission denied or not yet requested")).toBe("Camera permission denied or not yet requested");
    expect(scannerErrorMessage({ message: "Camera unavailable" })).toBe("Camera unavailable");
    expect(scannerErrorMessage("cancelled")).toContain("Scan cancelled");
  });
});
