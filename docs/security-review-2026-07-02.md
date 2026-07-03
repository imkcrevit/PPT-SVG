# PPT-SVG 安全与优化审查报告（2026-07-02）

> 由多代理并行审查汇总。核实说明：配置代理曾把 `request-security.ts:249` 的路径校验判为"安全"，属误判——另有两个代理与人工均核实 `startsWith` 无法阻止 `..`，确为真实漏洞，以核实结论为准。审查期间发现本机 C: 盘 100% 占满（与项目无关，建议清理）。

## 整体判断

基础防护优于同规模开源项目：有分级限流、zip 解压上限、magic-byte 文件类型校验、sessionId 格式校验、密钥只走 header 不落日志。核心问题集中在"信任边界"：所有 API 无鉴权，且限流/文件访问建立在客户端可控数据（`X-Forwarded-For`、`sessionId`、`attachment.path`）之上，可被绕过。存在公网 demo（labs.graptolite.ai/ppt），下列项应尽快处理。

---

## 🔴 严重（Critical）

### 1. 限流可被完全绕过 → 无限消耗 OpenRouter 额度
- 位置：`src/lib/request-security.ts:349-355`（`clientRateKey`）、`src/lib/session.ts`（`normalizeSessionId`）
- 问题：限流两个维度全部由攻击者控制。`clientRateKey` 裸信任 `X-Forwarded-For`/`X-Real-IP`/`CF-Connecting-IP`；`normalizeSessionId` 在 sessionId 缺失/非法时自动生成新 UUID 而非拒绝。
- 利用：每请求带随机 `X-Forwarded-For` 且不带 sessionId → 每次落新桶，限流与并发守卫永不触发，每次生成触发 2-4 次 LLM 调用直接烧钱。
- 修改：IP 从平台连接 IP 或可信代理跳数推导（CF 场景验证来源）；sessionId 非法时拒绝，仅接受服务端签发的高熵 ID；公网加轻量鉴权。

---

## 🟠 高（High）

### 2. 客户端可控 `attachment.path` → 任意文件读取 + DoS（已核实）
- 位置：校验仅 `src/lib/request-security.ts:249`；下沉点 `src/lib/theme-extract.ts:226,248`（`readFile(a.path)`），经 `resolveStyleContext` 从 generate 触发。
- 问题：`startsWith("/tmp/ppt-svg/uploads/")` 无法阻止 `..`；`/tmp/ppt-svg/uploads/../../../etc/passwd` 通过校验后被 `readFile` 解析到真实目标。
- 影响：任意文件读取（主题色/背景泄露信息）；指向 `/dev/zero`/大文件/FIFO 造成内存 DoS（`size` 从不与真实文件比对）；跨用户读取他人上传文件。
- 修改：不信任客户端路径——只接受 `{hash, extension, date}` 服务端重建 `/tmp/ppt-svg/uploads/<date>/<hash>.<ext>`，或按 session 从 MongoDB 查。若必须收路径：`path.resolve()` 后断言在 uploads 根内、拒绝 `..`、`stat` 校验真实大小。

### 3. systemd 服务以 root 运行
- 位置：`deploy/systemd/ppt-svg.service:10-12`
- 问题：应用任何 RCE（如 sharp 解析上传图片）直接拿 root。
- 修改：`User=ppt-svg`（或 `DynamicUser=yes`）+ `NoNewPrivileges=yes`、`ProtectSystem=strict`、`ProtectHome=yes`、`PrivateTmp=yes`；`WorkingDirectory` 移到 `/opt` 或 `/srv`。

### 4. Content-Length 缺失时体积校验被跳过 → 无上限缓冲请求体
- 位置：`src/lib/request-security.ts:74-91`
- 问题：无 `content-length` 头时返回 `{ ok: true }`，`request.json()`/`formData()` 无上限读入内存。
- 利用：`Transfer-Encoding: chunked` + 无 content-length + 数 GB body → 内存耗尽。
- 修改：读流时做硬上限（增量读取、超限 abort），缺头走"读并限流"而非跳过。

---

## 🟡 中（Medium）

### 5. Export 端点无元素数量/嵌套深度/体积上限 → CPU DoS
- 位置：`src/lib/figure-validation.ts:84-90,120`；`/api/export/pptx`、`/api/export/bundle`
- 问题：figure 校验对元素数与 group 深度无限制，`normalizeFigureLayout` 跑最多 5 轮 O(n²)。~10 万小元素卡住 worker 数分钟；深嵌套 group 驱动递归。
- 修改：export 路由加 body 体积上限、最大叶子元素数（如 500）、最大 group 深度（如 8）。

### 6. 全站无任何安全响应头
- 位置：`next.config.mjs`（无 `headers()`/middleware）；nginx 示例亦无
- 修改：`next.config.mjs` 加 `async headers()`（nosniff + `frame-ancestors 'none'` + Referrer-Policy），nginx 镜像 `add_header`。

### 7. /tmp 无 TTL/清理/配额 → 磁盘 DoS
- 位置：`src/lib/attachments.ts:55`、`generated-artifacts.ts:31`、`token-usage.ts`、`generate-agent/route.ts:498`
- 问题：全部写死 `/tmp/ppt-svg/` 从不删除；`readTokenUsageHistory` 每次读整个文件入内存。
- 修改：基于时间的清理（systemd-tmpfiles/cron）、per-session 字节上限；失败调试文件用 env flag 关闭并限量；`mkdir` 用 `mode: 0o700`。

### 8. Zip-bomb 防护可绕过（fail-open）
- 位置：`src/lib/attachments.ts:230-238`（`zipEntrySize`）
- 问题：`_data.uncompressedSize` 缺失时返回 0，贡献 0 绕过 80MB 上限，`.async("string")` 时炸开。
- 修改：`uncompressedSize` 缺失时直接拒绝（fail-closed），或 `.async` 时按条目限制读取长度。

### 9. 主题提取 PPTX 读取路径跳过 zip 安全检查
- 位置：`src/lib/theme-extract.ts:37-42`（`extractThemeFromPptx` 无 `assertSafeZip`）
- 修改：所有 `JSZip.loadAsync` 结果过 `assertSafeZip`，theme XML 读取设长度上限。

### 10. 未鉴权的跨会话产物读取
- 位置：`app/api/sessions/[sessionId]/latest/route.ts`
- 问题：sessionId 实为 bearer 凭证，格式允许客户端自选、最短 8 字符小字母表，弱 ID 可枚举读取他人图形/prompt，且该 GET 无限流。
- 修改：绑定认证主体授权；至少加限流 + 强制服务端签发高熵 sessionId。

### 11. 依赖与 TLS
- `next@16.2.6` 打包有漏洞 postcss（<8.5.10，GHSA-qx2v-qp2m-jg93，moderate，构建期）→ 升 `next@^16.3`。`npm audit` 全量 1 low + 3 moderate（其余 dev 链路 @babel/core、js-yaml）。
- nginx 示例仅 `listen 80` 无 TLS/HSTS → 补 443 或文档化 Cloudflare Full-Strict。
- CVE-2025-29927 不受影响（无 middleware.ts 且版本 >15.2.3）。

---

## 🟢 低（Low）

- 错误信息回显 `error.message`（generate/optimize/sessions latest）→ 通用信息 + 服务端记 requestId。
- `svg.ts` 属性裸插值（`fill`/`stroke`/`background`/`id`，`svg.ts:16,26,30…`）→ 属性值也做 `escapeXml` 或断言格式。
- sharp 未显式设限（`theme-extract.ts:196`）→ 显式 `{ limitInputPixels, failOn: "error" }`。
- 上传写入跟随符号链接（`attachments.ts:59`）→ `flag: "wx"` 或先写临时名再 rename。
- `canvas.fontFamily` 被校验丢弃（`figure-validation.ts:68-72`，功能回归）→ 修复时对字体名白名单再透传。
- `start.sh` 杀 3000 端口无关进程（`start.sh:121-160`）→ 只杀匹配本项目路径的进程或要求 `FORCE=1`。
- nginx `client_max_body_size 4m` < 应用 13MB → 改 `13m` 或统一下调。

---

## ⚡ 性能优化

- 附件重复读取/解析：`sanitizeUploadedAttachment` 丢弃上传时算好的 theme，每次生成重新读盘重算；单 PPTX 上传时 `JSZip.loadAsync` 解析 3 次 → 按 hash 缓存 theme，解析一次复用。
- figure 布局 O(n²)：字号收缩每次 -1pt（最多 64 轮，每轮重跑 `wrapSvgText`）→ 二分或缓存；`assignments.set(k, [...old, item])` copy 累加 → push。
- React 预览：`wrapSvgText`+`limitLinesToHeight` 每次重渲染（含点选）对所有文本重跑 → 按 (text,width,fontSize) memo 化。

---

## 建议处理顺序

1. 先堵省事高价值项：安全头（#6）、export 数量/深度/体积上限（#5）、zip fail-closed（#8/#9）、systemd 降权（#3）。
2. 再做信任边界重构：附件按 hash 服务端解析路径（#2）、限流用可信 IP + 拒绝非法 sessionId（#1）、内容长度硬上限（#4）。
3. 补运维：/tmp TTL 清理（#7）、升级 next（#11）、nginx TLS + body size 对齐。
