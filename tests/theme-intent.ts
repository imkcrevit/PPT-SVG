// Conversational theme-intent parser test.
// Run: node --experimental-strip-types tests/theme-intent.ts

import { parseThemeIntent, resolveThemeIntent, mentionsStyle } from "@/lib/theme-intent";

interface Case { msg: string; ctx?: { detectedBackground?: string }; expect: Record<string, unknown> | undefined; }

const CASES: Case[] = [
  { msg: "把背景改成深蓝", expect: { background: "#0A2A5E" } },
  { msg: "背景用 #112233", expect: { background: "#112233" } },
  { msg: "用那个图片的背景", ctx: { detectedBackground: "#2F6FED" }, expect: { background: "#2F6FED" } },
  { msg: "去掉背景色", expect: { background: "#FFFFFF" } },
  { msg: "恢复白底", expect: { background: "#FFFFFF" } },
  { msg: "字体用宋体", expect: { fontFamily: "SimSun" } },
  { msg: "字体换成微软雅黑", expect: { fontFamily: "Microsoft YaHei" } },
  { msg: "文字颜色用白色", expect: { text: "#FFFFFF" } },
  { msg: "主色换成红色和蓝色", expect: { accents: ["#E53935", "#2F6FED"] } },
  { msg: "配色用 #E2231A、#003A70、#00853F", expect: { accents: ["#E2231A", "#003A70", "#00853F"] } },
  { msg: "背景换成绿色,字体用黑体", expect: { background: "#2E9E76", fontFamily: "SimHei" } },
  { msg: "帮我画个流程图", expect: undefined }
];

let pass = true;
console.log("=== deterministic ===");
for (const c of CASES) {
  const got = parseThemeIntent(c.msg, c.ctx ?? {});
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  pass = pass && ok;
  console.log(`${ok ? "PASS" : "FAIL"}  "${c.msg}" -> ${JSON.stringify(got)}`);
}

// LLM fallback only fires when deterministic misses AND the message mentions style
async function llmCases() {
  console.log("\n=== LLM fallback (stubbed) ===");
  const stub = async () => '{"accents":["#C9CCD3","#8A8F99"],"background":"#FFFFFF"}';
  const a = await resolveThemeIntent("把配色调成性冷淡风", {}, stub);
  const aOk = !!a && Array.isArray(a.accents);
  console.log(`${aOk ? "PASS" : "FAIL"}  fuzzy style msg -> LLM -> ${JSON.stringify(a)}`);
  let called = false;
  const spy = async () => { called = true; return "{}"; };
  await resolveThemeIntent("帮我画个架构图", {}, spy);
  const bOk = !called && mentionsStyle("帮我画个架构图") === false;
  console.log(`${bOk ? "PASS" : "FAIL"}  non-style msg -> LLM NOT called`);
  pass = pass && aOk && bOk;
}

await llmCases();
console.log(pass ? "\nTHEME INTENT OK ✅" : "\nSOME FAILED ❌");
if (!pass) process.exitCode = 1;
