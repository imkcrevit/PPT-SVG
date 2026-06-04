import { buildExportFilename } from "@/lib/export-filename";

function assertEqual(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}

assertEqual(buildExportFilename("api-mainstream-2026-05-28T14-44-34Z-01-swimlane", 1, "svg"), "api-mainstream-2026-05-28T14-44-34Z-01-swimlane-1.svg");
assertEqual(buildExportFilename("9ed0a8d7-1f75-4d58-86df-64696aa98756", 2, "pptx"), "9ed0a8d7-1f75-4d58-86df-64696aa98756-2.pptx");
assertEqual(buildExportFilename(" bad/session id ", 0, "svg"), "bad-session-id-1.svg");
assertEqual(buildExportFilename("session", 3, "png"), "session-3.png");
assertEqual(buildExportFilename("session", 4, "zip"), "session-4.zip");

console.log("EXPORT FILENAME TEST PASS");
