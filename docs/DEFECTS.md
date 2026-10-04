# 已知漏洞

记录本仓库已知的缺陷，含已修复条目。每条包含：现象、证据、影响、复现、建议修复。

---

## D1 — 外部技能目录既不随包发布，也不被校验，缺失时静默降级

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-04 |
| 状态 | 部分修复（2026-10-04）：包内 `skills/` 解析回退与挂载期显式告警已落地（`src/host.ts`）；两个技能目录的内容仍未随包发布 |
| 严重度 | 高：六类执行角色的协议文档全部失效，且不产生任何错误 |

### 现象

插件的角色协议与实现标准**全部**来自两个外部技能目录：

- `workflowSkillDir` → `<dir>/references/roles/<protocol>`
- `implementationStandardDir` → `<dir>/SKILL.md`；省略时取 `<workflowSkillDir>/../audit-implementation-simplicity/SKILL.md`

这两个目录既不在 `package.json` 的 `files` 里，也不在 `dependencies` / `peerDependencies` 里，
README 的 Requirements 表把它列为配置字段，但没有给出任何获取方式。目录缺失时插件照常挂载、
工具照常返回，只是每个 worker 的 developer instructions 指向一个不存在的文件。

### 证据

| 事实 | 来源 |
| --- | --- |
| 路径缺失时退化成一段说明文字，而不是报错或警告 | `src/roles.ts:72`（`roleProtocolPath`）、`src/roles.ts:73`–`75`（`standardPath`） |
| 打包清单不含任何技能内容 | `package.json` → `files: ["lib", "locale/*.json", "profiles", "docs", "scripts", "cordis.patch.yml"]` |
| `status` 回显 `workflowSkillDir`，但不校验它是否存在 | `src/workflow.ts:819`（未采纳分支）、`src/workflow.ts:669`（`summary`） |
| 本机两个目录都不存在 | `ls /Users/slepher/project/codex-workflow/skills/codex-workflow` 与 `.../skills/audit-implementation-simplicity` 均 `ENOENT` |
| 相邻 provider 的 live 脚本假设同一路径 | `dsh-codex-app-provider/scripts/test-live.mjs:88`：`resolve(root, "../../codex-workflow/skills/codex-workflow")` |
| 同一缺口此前已被记录为“本地可复现性缺口” | `dsh-codex-app-provider/FUNCTION-MAP.zh-CN.md:361` |
| 部署侧可以“已启用但未配置” | `desktop` profile 的 patch 层原先没有该条目的 `config:` 块；Config 投影为 `acceptsMissing: true`、`default: {}` |

### 期望目录结构（由代码反推，仓库内无任何一处完整声明）

```
<workflowSkillDir>/SKILL.md                             # src/prompts/worker-execution.md:53 提到它
<workflowSkillDir>/references/roles/planner.md          # ROLES[].protocol
<workflowSkillDir>/references/roles/reviewer.md
<workflowSkillDir>/references/roles/context-collector.md
<workflowSkillDir>/references/roles/coding-worker.md
<workflowSkillDir>/references/roles/evidence-runner.md
<workflowSkillDir>/references/roles/full-tester.md
<workflowSkillDir>/../audit-implementation-simplicity/SKILL.md
```

### 影响

- `planner`、`reviewer`、`context_collector`、`coding_worker`、`evidence_runner`、`full_tester`
  六类角色拿到的都是一条指向不存在文件的字符串，角色协议实际未生效，
  而 `codex_workflow { action: "roles" }` 仍然正常返回 6 个角色，看起来一切正常。
- 失败发生在**子代理内部**：父会话既看不到挂载失败，也看不到工具报错，只在真实派发并读到
  worker 的 developer instructions 时才暴露。
- 与“已启用但未写入 `config:`”叠加时，症状只表现为客户端配置选择器显示“配置尚未安装”，
  指向的却不是真正的原因。

### 复现

1. 在没有任何 `codex-workflow` 技能目录的机器上，加载包含本插件的 profile。
2. `codex_workflow { action: "roles" }` → 正常返回 6 个角色（无错误）。
3. `codex_workflow { action: "status" }` → 回显 `workflowSkillDir`，但该路径不存在。
4. `codex_workflow { action: "dispatch", … }` 后查看子代理的 developer instructions：
   `roleProtocolPath` 指向 `<workflowSkillDir>/references/roles/<protocol>`，文件不存在。

### 建议修复（按优先级）

1. **挂载时校验。** `workflowSkillDir` / `implementationStandardDir` 非空时，校验目录存在，
   且 `references/roles/` 下具备契约要求的全部协议文档；缺失即显式报错（或至少明确 warn），
   不要降级成一句说明文字。
2. **来源可发现。** 在 README 的 Requirements 表补上两个技能的获取方式；
   或把它们作为包内容 / 可选依赖发布，让 `prepare:local` 一类的脚本能安装它们。
3. **部署状态可见。** `status` 目前只回显 `workflowSkillDir`；再回显生效的 `stateDir` 与
   `defaultProfile`，并把“该值是内建默认还是部署配置”标出来，让“已启用但未配置”当场可见。

### 已落地的部分（2026-10-04）

- `src/host.ts` 在 `workflowSkillDir` / `implementationStandardDir` 未配置时，回退到解析本包
  `skills/` 目录（以 `import.meta.url` 为基准，因此 link、tarball、registry、git 安装都能找到
  自己的内容）；配置了但读不到时不再静默：挂载时一次性 `warn`，列出缺失的协议文件与生效路径。
- 未随包发布技能内容这一点**仍然成立**：`skills/` 目录为空，回退因此不生效，告警照常触发。
  剩余工作是把内容放进该目录（并加入 `files`）。

---

## D2 — 载波请求自带的 `signal` 被当作本通道的取消令牌，使选择器恒为空（已修复）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-04 |
| 状态 | **已修复**：`src/profile-rpc.ts`；运行中的 Host 已热加载并端到端验证 |
| 严重度 | 高：`/workflow` 的每一次调用都失败，配置选择器与 Workflow 设置页读不到任何配置 |

### 现象

客户端配置选择器显示「配置尚未安装」（`pickerMissing`），紧邻的错误文本是
`This operation was aborted`；Workflow 设置页同样读不到配置目录。

### 根因

`installProfileRpc` 把载波请求对象自带的信号当成本通道队列操作的取消令牌：

```ts
envelope(res, 200, message.rpcId, await dispatch(endpoint, message.payload, req.signal ?? new AbortController().signal));
```

`WebRoute['handler']` 收到的是 `node:http` 的 `IncomingMessage`。**从 Node 24.14 起该对象自带
`signal`**（本机桌面运行时 Node 24.21.0，已实测），`??` 回退分支因此不再生效，通道改用了一个它
并不拥有的信号：缓冲体读完时该信号已中止，于是 `dispatch` 的第一条语句
`signal.throwIfAborted()` 对**每一个**请求抛错。

### 证据

| 事实 | 来源 |
| --- | --- |
| 连未知端点也在同一处失败，证明失败早于端点校验 | 实测 `POST /workflow/bogus` → `This operation was aborted` |
| 该字段在 Node 24.13 不存在、在 24.21 存在 | `'signal' in http.IncomingMessage.prototype` → 24.13.1 `false`、24.21.0 `true` |
| 载波并不提供它，它属于 `node:http` | `app.asar` 内 `@deepseek-ai/dsh-host-webserver/lib/index.js` 全文无 `signal`；路由直接 `await route.handler(req, res)` |
| 参考实现从不读它，而是自建控制器 | `@deepseek-ai/dsh-client-connection` 的 `bridge()`：`const abort = new AbortController(); res.on("close", () => { if (!res.writableEnded) abort.abort(); })` |
| 本仓库测试看不见该缺陷 | 测试替身固定传 `signal: undefined`，`??` 分支恰好让测试走了另一条路 |

### 复现

用浏览器自身的会话 cookie POST 到 `http://127.0.0.1:19387/workflow/profiles`：

```json
{"ok":false,"error":{"code":"workflow/rejected","message":"This operation was aborted","details":{}}}
```

### 修复

通道自持取消令牌，规则与参考实现一致：**只有响应在写出前关闭才取消该请求的操作**。
`RpcRequest` 不再声明 `signal`，`RpcResponse` 增加 `on("close")` 与 `writableEnded`。

### 回归

`test/profile-rpc.test.mjs` 与 `test/host-strategy.test.mjs` 的请求替身改为携带**已中止**的
`signal`，响应替身补齐 `on`/`writableEnded`。修复前这两个文件有 3 个用例失败，修复后全部通过。

---

## D3 — 包外 `file:` devDependency 让 git 安装整体失败（已修复）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-04 |
| 状态 | **已修复**：`package.json` / `package-lock.json` 移除该说明，改由暂存脚本提供类型；`prepare` 自包含 |
| 严重度 | 高：`dsh plugin add github:…` 完全装不上，且失败发生在安装期而非运行期 |

### 现象

从 Git 安装直接失败：

```
[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package … npm-install: `npm install` Exit status 254
```

即使仓库里补上 `prepare`，只要这条说明还在，安装仍然装不上。

### 根因

`devDependencies` 里有一条离开本包的说明：

```json
"dsh-codex-app-provider": "file:../dsh-codex-app-provider/dsh-codex-app-provider-0.1.1.tgz"
```

pnpm 在执行 `prepare` 之前，会先在抓取下来的 git 副本里跑一次 `npm install`；包外的 `file:`
说明被解析到 store 的临时目录，而不是任何真实相邻 checkout。

### 证据

| 事实 | 来源 |
| --- | --- |
| 包外说明解析到 store 临时目录 | npm 日志：`error path …/.pnpm-store/v11/tmp/sibling-types/sibling-types-1.0.0.tgz`、`error code ENOENT` |
| 对照组（同样的 git 包，仅去掉该 devDep）装上并成功执行 `prepare` | 同机 pnpm 11.7.0 实测 |
| 官方文档对 prepare 的同一要求 | 《Package and install》：“must not assume dev-only context such as a sibling monorepo checkout” |
| `link:` / `file:` 本地目录安装不执行 `prepare` | 同机实测；因此本改动不影响本地文件夹安装流程 |

### 修复

- 从 `devDependencies` 与 `package-lock.json` 移除该说明；`peerDependencies` 的 `0.1.1` 保留，
  那是运行时契约。
- 新增 `scripts/prepare-build.mjs` 作为自包含 `prepare`：只转译、不解析包外类型，git 安装因此成立。
- 本地类型检查改由 `scripts/stage-provider-types.mjs` 把相邻 checkout 的构建结果暂存进本包
  自己的 `node_modules`——这是唯一能保住 `declare module "@deepseek-ai/cordis"` 增强合并的位置
  （`paths` 与符号链接都会让增强落到 provider 自己那份 cordis 上）。
- 包内 patch 补 `defaultProfile: gpt-workflow`，用户不再需要手写 profile 配置。

### 回归

- `test/exports.test.mjs`：新增断言，manifest 与锁文件中不得出现任何离开本包的 `file:` 说明。
- `test/stage-provider-types.test.mjs`：覆盖暂存结果与“未构建即报错”。
- 源码形态的 git 安装演练：把仓库按 `git ls-files --cached --others --exclude-standard` 导出
  （不含 `lib/`、`node_modules/`），在其中执行 `prepare` → 产出 18 个模块全部通过 `node --check`，
  `lib/index.js` 与 `lib/client.js` 均在位，模块图未被内联破坏。唯一相对本地构建缺的是
  `lib/client/*` 中间产物与 `.d.ts` 声明文件。
