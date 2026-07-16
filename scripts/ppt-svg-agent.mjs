#!/usr/bin/env node

// Backward-compatible entry point. The canonical client ships with the SVG skill.
await import("../plugins/ppt-svg/skills/svg/scripts/generate-svg.mjs");
