import { checkPermissions, requestPermissions, scan, Format } from "@tauri-apps/plugin-barcode-scanner";

export async function scanPairingTicket(): Promise<string> {
  let permission = await checkPermissions();
  if (permission === "prompt") {
    permission = await requestPermissions();
  }
  if (permission !== "granted") {
    throw new Error("Camera access is off. Enable Camera for MonoCode Companion in iPhone Settings, then scan again.");
  }
  const result = await scan({ formats: [Format.QRCode], windowed: false });
  return result.content;
}

export function scannerErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message
    : typeof reason === "string" ? reason
    : reason && typeof reason === "object" && "message" in reason && typeof reason.message === "string" ? reason.message
    : "Could not open the QR scanner. Try again.";
  return message === "cancelled" ? "Scan cancelled. Tap Scan QR ticket to try again." : message;
}
