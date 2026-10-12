#!/usr/bin/env node
// Local diagnostic client. This is not the internet transport or phone app.
import { readFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const APPLICATION = "com.monocode.companion-spike";
const ACTIONS = new Set(["sessions.list", "sessions.read", "sessions.create", "sessions.send", "sessions.approve", "sessions.stop", "sessions.configure"]);

export async function companionRequest({ descriptor, action, input = {}, requestId = randomUUID() }) {
  if (!ACTIONS.has(action)) throw new Error("Unsupported companion action");
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("Input must be a JSON object");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw new Error("Invalid request ID");
  const info = await lstat(descriptor);
  if (!info.isFile() || (process.platform !== "win32" && (info.mode & 0o077)))
    throw new Error("Descriptor must be a private regular file (mode 0600)");
  const connection = JSON.parse(await readFile(descriptor, "utf8"));
  if (connection.application !== APPLICATION || connection.version !== 1 ||
      !/^127\.0\.0\.1:[0-9]{1,5}$/.test(connection.endpoint) ||
      !/^[a-f0-9]{64}$/.test(connection.token))
    throw new Error("Invalid isolated-app descriptor");
  const port = Number(connection.endpoint.split(":")[1]);
  if (port < 1 || port > 65535) throw new Error("Invalid loopback port");
  const request = JSON.stringify({ token: connection.token, namespace: "companion", action, input, requestId }) + "\n";
  if (Buffer.byteLength(request) > 262_144) throw new Error("Request is too large");
  return await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let raw = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve({ requestId, ...value });
    };
    socket.setTimeout(40_000, () => finish(new Error(`Request outcome unknown. Retry the same input with --request-id ${requestId}`)));
    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      if (raw.length > 2 * 1024 * 1024) return finish(new Error("Response exceeds diagnostic client limit"));
      const end = raw.indexOf(10);
      if (end < 0) return;
      try { finish(null, JSON.parse(raw.subarray(0, end).toString("utf8"))); }
      catch { finish(new Error("Invalid desktop response")); }
    });
    socket.on("error", (error) => finish(new Error(`${error.message}. Keep request ID ${requestId} if retrying.`)));
    socket.on("end", () => finish(new Error(`Connection ended before a receipt. Keep request ID ${requestId} if retrying.`)));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    console.log(`Local companion diagnostic client\n\nnode scripts/companion-client.mjs ACTION '[JSON]' [--descriptor PATH] [--request-id ID]\n\nActions: sessions.list, sessions.read, sessions.create, sessions.send, sessions.approve, sessions.stop, sessions.configure\nRead a session first. Mutations require its epoch, sessionId and turn. Creation instead requires the list epoch, advertised projectId and a new session UUID.\nApprove also requires blockId and decision (allow/deny); send requires text.\nUse the same request ID and exact input after an uncertain response.\nThe default descriptor is the isolated macOS development app's private file.`);
    return;
  }
  const action = args.shift();
  const input = args[0] && !args[0].startsWith("--") ? JSON.parse(args.shift()) : {};
  let descriptor = join(homedir(), "Library", "Application Support", APPLICATION, "companion-spike.json");
  let requestId = randomUUID();
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--descriptor") descriptor = value;
    else if (flag === "--request-id") requestId = value;
    else throw new Error(`Unknown option ${flag}`);
  }
  const response = await companionRequest({ descriptor, action, input, requestId });
  console.log(JSON.stringify(response, null, 2));
  if (!response.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
