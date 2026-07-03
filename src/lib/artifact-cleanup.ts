// Age-based reaper for the ephemeral artifacts the app writes under
// /tmp/ppt-svg (uploads/<date>/… and sessions/<id>/…). Nothing else deletes
// them, so on a long-running deployment they accumulate until /tmp fills.
//
// This runs opportunistically (throttled to once per hour per instance) and is
// fire-and-forget; a declarative deploy/systemd/ppt-svg-tmpfiles.conf covers the
// same ground for hosts that prefer systemd-tmpfiles.

import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join("/tmp", "ppt-svg");
const THROTTLE_MS = 60 * 60 * 1000;
const DEFAULT_TTL_HOURS = 48;

let lastRunAt = 0;

function ttlMs(): number {
  const raw = process.env.PPT_SVG_ARTIFACT_TTL_HOURS;
  const hours = raw ? Number(raw) : NaN;
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
}

// Kick off a reap without blocking the caller. Safe to call on every request.
export function scheduleArtifactReap(now = Date.now()): void {
  if (now - lastRunAt < THROTTLE_MS) {
    return;
  }
  lastRunAt = now;
  void reap(now - ttlMs()).catch(() => {
    // Best-effort cleanup; never surface to the request path.
  });
}

async function reap(cutoffMs: number): Promise<void> {
  await Promise.all([
    reapChildren(path.join(ROOT, "uploads"), cutoffMs),
    reapChildren(path.join(ROOT, "sessions"), cutoffMs)
  ]);
}

async function reapChildren(dir: string, cutoffMs: number): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory does not exist yet (e.g. fresh deploy / Windows dev)
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const full = path.join(dir, entry.name);
    try {
      const info = await stat(full);
      if (info.mtimeMs < cutoffMs) {
        await rm(full, { recursive: true, force: true });
      }
    } catch {
      // Ignore races (dir removed concurrently) and permission errors.
    }
  }
}
