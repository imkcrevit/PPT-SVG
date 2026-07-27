import { buildGenerationFallback } from "@/lib/generation-fallback";
import type { FigureElement, GenerateFigureRequest } from "@/lib/types";

function flatten(elements: FigureElement[]): FigureElement[] {
  return elements.flatMap((element) => element.type === "group" ? [element, ...flatten(element.children)] : [element]);
}

function request(userDescription: string): GenerateFigureRequest {
  return { skillId: "pie", userDescription, language: "zh" };
}

let allPass = true;
function check(name: string, condition: boolean): void {
  allPass = allPass && condition;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
}

const withValues = buildGenerationFallback(
  request("生成渠道占比饼图：直营 50，合作伙伴 30，线上 20"),
  "fallback-values",
  "test"
);
const valueElements = flatten(withValues.figure.elements);
check(
  "pie fallback preserves supplied values",
  valueElements.filter((element) => element.type === "polygon" && element.id.startsWith("pie-slice-")).length === 3
);
check("pie fallback keeps routed skill", withValues.figure.metadata.skillId === "pie");

const withoutValues = buildGenerationFallback(request("生成一个渠道占比饼图"), "fallback-empty", "test");
const emptyElements = flatten(withoutValues.figure.elements);
check("missing values show an explicit empty state", emptyElements.some((element) => element.id === "pie-empty"));
check("missing values do not invent proportions", !emptyElements.some((element) => element.id.startsWith("pie-slice-")));
check(
  "fallback no longer invents ticketing architecture",
  !emptyElements.some((element) => element.type === "text" && /售票|订单|支付|ticket|payment/i.test(element.text))
);

console.log(allPass ? "\nGENERATION FALLBACK ASSERTIONS PASS" : "\nGENERATION FALLBACK ASSERTIONS FAILED");
if (!allPass) process.exitCode = 1;
