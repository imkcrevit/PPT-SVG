// Image theme classifier regression test.
//
// This exercises the pure pixel classifier in theme-extract without needing
// image fixtures. It locks down the distinction between intentional palettes
// and incidental backgrounds/screenshots.

import { analyzeImageStyle, buildImageNotice, type ImageStyleReason } from "@/lib/theme-extract";

type Pixel = [number, number, number];

interface Case {
  id: string;
  pixels: Pixel[];
  expectedReason: ImageStyleReason;
  expectedAccentCount?: number;
  expectedBackground?: string;
  expectsTheme?: boolean;
  expectsNoticeIncludes?: string;
}

function repeat(pixel: Pixel, count: number): Pixel[] {
  return Array.from({ length: count }, () => pixel);
}

function pixels(...groups: Pixel[][]): Buffer {
  return Buffer.from(groups.flat().flat());
}

const CASES: Case[] = [
  {
    id: "brand-palette-on-white-background",
    pixels: [
      ...repeat([255, 255, 255], 70),
      ...repeat([226, 35, 26], 15),
      ...repeat([0, 58, 112], 15)
    ],
    expectedReason: "palette",
    expectedAccentCount: 2,
    expectedBackground: "#FFFFFF",
    expectsTheme: true,
    expectsNoticeIncludes: "提取 2 种主色"
  },
  {
    id: "palette-strips-coloured-background",
    pixels: [
      ...repeat([10, 42, 94], 60),
      ...repeat([226, 35, 26], 20),
      ...repeat([0, 133, 63], 20)
    ],
    expectedReason: "palette",
    expectedAccentCount: 2,
    expectedBackground: "#0A2A5E",
    expectsTheme: true,
    expectsNoticeIncludes: "图片背景色(#0A2A5E)已被忽略"
  },
  {
    id: "solid-background-is-not-theme",
    pixels: repeat([10, 42, 94], 100),
    expectedReason: "solid-bg",
    expectedBackground: "#0A2A5E",
    expectsTheme: false,
    expectsNoticeIncludes: "已忽略"
  },
  {
    id: "dark-ui-screenshot-is-rejected",
    pixels: [
      ...repeat([32, 32, 32], 70),
      ...repeat([88, 88, 88], 20),
      ...repeat([226, 35, 26], 10)
    ],
    expectedReason: "screenshot",
    expectedBackground: "#202020",
    expectsTheme: false,
    expectsNoticeIncludes: "已忽略"
  },
  {
    id: "too-many-hues-is-too-rich",
    pixels: [
      ...repeat([226, 35, 26], 12),
      ...repeat([226, 120, 26], 12),
      ...repeat([242, 169, 0], 12),
      ...repeat([46, 158, 118], 12),
      ...repeat([0, 147, 178], 12),
      ...repeat([47, 111, 237], 12),
      ...repeat([122, 90, 196], 14),
      ...repeat([214, 69, 124], 14)
    ],
    expectedReason: "too-rich",
    expectsTheme: false,
    expectsNoticeIncludes: "色彩过于丰富"
  },
  {
    id: "neutral-image-has-no-colour",
    pixels: [
      ...repeat([242, 242, 242], 80),
      ...repeat([120, 120, 120], 20)
    ],
    expectedReason: "no-colour",
    expectedBackground: "#F2F2F2",
    expectsTheme: false
  },
  {
    id: "empty-input",
    pixels: [],
    expectedReason: "none",
    expectsTheme: false
  }
];

let allPass = true;

for (const testCase of CASES) {
  const data = pixels(testCase.pixels);
  const result = analyzeImageStyle(data, 3);
  const notice = buildImageNotice(result);
  const failures: string[] = [];

  if (result.reason !== testCase.expectedReason) {
    failures.push(`reason ${result.reason}, expected ${testCase.expectedReason}`);
  }

  if ((result.theme !== undefined) !== Boolean(testCase.expectsTheme)) {
    failures.push(`theme presence ${Boolean(result.theme)}, expected ${Boolean(testCase.expectsTheme)}`);
  }

  if (testCase.expectedAccentCount !== undefined && result.accentCount !== testCase.expectedAccentCount) {
    failures.push(`accentCount ${result.accentCount}, expected ${testCase.expectedAccentCount}`);
  }

  if (testCase.expectedBackground !== undefined && result.detectedBackground !== testCase.expectedBackground) {
    failures.push(`background ${result.detectedBackground}, expected ${testCase.expectedBackground}`);
  }

  if (result.theme && result.theme.background !== "#FFFFFF") {
    failures.push(`image theme background ${result.theme.background}, expected stripped #FFFFFF`);
  }

  if (testCase.expectsNoticeIncludes && !notice?.includes(testCase.expectsNoticeIncludes)) {
    failures.push(`notice ${JSON.stringify(notice)}, expected to include ${JSON.stringify(testCase.expectsNoticeIncludes)}`);
  }

  const ok = failures.length === 0;
  allPass = allPass && ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${testCase.id}`);
  failures.forEach((failure) => console.log(`        - ${failure}`));
}

console.log(allPass ? "\nTHEME IMAGE CLASSIFIER OK" : "\nSOME FAILED");
if (!allPass) process.exitCode = 1;
