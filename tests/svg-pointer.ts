import { clientPointToSvg } from "@/lib/svg-pointer";

function assertPoint(
  name: string,
  actual: { x: number; y: number },
  expected: { x: number; y: number }
) {
  const tolerance = 0.001;
  if (Math.abs(actual.x - expected.x) > tolerance || Math.abs(actual.y - expected.y) > tolerance) {
    throw new Error(`${name}: expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`);
  }
  console.log(`PASS  ${name}`);
}

const viewBox = { x: 0, y: 0, width: 1280, height: 720 };

assertPoint(
  "responsive 16:9 preview",
  clientPointToSvg(420, 230, { left: 100, top: 50, width: 640, height: 360 }, viewBox),
  { x: 640, y: 360 }
);

assertPoint(
  "vertical letterbox offset",
  clientPointToSvg(500, 350, { left: 100, top: 50, width: 800, height: 600 }, viewBox),
  { x: 640, y: 360 }
);

assertPoint(
  "zoomed and scrolled viewport",
  clientPointToSvg(640, 360, { left: -320, top: -180, width: 1920, height: 1080 }, viewBox),
  { x: 640, y: 360 }
);

assertPoint(
  "pointer capture clamps outside canvas",
  clientPointToSvg(-100, 900, { left: 0, top: 0, width: 1280, height: 720 }, viewBox),
  { x: 0, y: 720 }
);

console.log("\nSVG POINTER COORDINATES PASS ✅");
