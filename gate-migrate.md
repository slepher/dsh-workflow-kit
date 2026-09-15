# gate-migrate

> Python 契约门的现状、处置与迁移计划。
> 目标：把「校验」从**两份手写实现 + agent 自觉调用**，收敛为**一份规格 + TS 实现 + 框架时机触发**。
> 本文只规划，不改代码。所有行号对应当前工作树（`src/workflow.ts`、`scripts/workflowctl.py`）。

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| Python 门是 agent 自己触发的吗 | **是，而且是两遍。** 第一遍由 skill 文档指示 agent 自己跑（`planner-mode.md:36`、`initial-planning.md:27`、`dispatch.md:27`）；第二遍由 Host 在 `adopt`/`record-result` 内部无条件拉起子进程 |
| 能否跳过 | 受管路径内**不能**；但「是否走受管路径」由 agent 选，`delegate` 全程不校验 |
| 迁到 TS 有价值吗 | **有，但要分开算**：换语言=中价值（去 Python 依赖、单一 schema、可写负面测试）；**把不变量搬到加载/派发时=高价值**；「绕过免疫」=插件做不到，属 DSH 策略层 |
| 最大风险 | 现在有**两份已经分歧的 `workflowctl.py`**，且分歧点正好在角色模型上（见 §2.2）。不先解决这个，迁到 TS 只会把「两份」变成「三份」 |

**决策建议**：先做 D1（统一规格与角色模型）→ 再做 D2（DSH 侧门迁 TS + 加载/派发时不变量）→ D3（native 侧 CLI 保形但由规格生成常量）→ D4（清理过度设计）。

---

## 1. 范围与非目标

**范围内**
- `scripts/workflowctl.py`（插件副本，332 行）的全部校验门。
- 与它同源但已分歧的 skill 副本 `$workflowSkillDir/scripts/workflowctl.py`（本机：`/home/slepher/.codex/skills/codex-workflow/scripts/workflowctl.py`，295 行）。
- Host 的两个调用点与其信任假设（`src/workflow.ts:171`、`:660`、`:725`）。
- 由校验门间接形成的合同/结果格式契约。

**非目标（明确不做）**
- 不改变受管工作流的授权模型：插件**无法**阻止父 agent 直接用原生工具改产品代码。若需要「产品变更必须过 lane → candidate → 独立审查 → integration」，那是 DSH 文件策略/工具门控的问题，另案。
- 不改变 `Plan`/`Task` 的语义字段（`workflow.ts:20–21`），只统一它们的校验来源。
- 不在本次迁移中调整 lane/集成/Git 相关门（它们已在 TS 内，位置正确）。

---

## 2. 现状事实

### 2.1 触发链

```
模型（planner/主 agent）
  ├─ 自觉：python3 <SKILL_DIR>/scripts/workflowctl.py validate <generation>      ← skill 文档要求
  └─ codex_workflow 工具调用
        ├─ action=adopt          → Workflow.python('export-dsh', generation)   workflow.ts:660
        └─ action=record-result  → Workflow.python('result-check', …)           workflow.ts:725
                                   （唯一出口 workflow.ts:171，注入 DSH_ROLE_PROFILES）

独立 CLI 子命令 validate（workflowctl.py:303）在插件内无调用方，只服务 skill 路径。
```

**受管路径不可绕过**：`adopt` 是唯一创建 run 的入口（`current()` 否则抛，`workflow.ts:335`）；`record-result` 是唯一进入 `candidate` 的路径（`:747`）；`accept` 要求先 `candidate`（`:752`）。但整条链是 opt-in，且 `delegate` 不触发任何校验。

### 2.2 两份实现已分歧（阻塞项）

| 维度 | skill 副本（295 行） | 插件副本（332 行） |
|---|---|---|
| 角色来源 | `role_profiles.py` + 规范 TOML（skill 自带） | `DSH_ROLE_PROFILES` env JSON，由 Host 注入（`workflow.ts:171–188`） |
| Role 合法性 | `roles - {dispatcher, planner, reviewer}` | `roles`（`ROLES` 目录 + 旧 def/sup 键） |
| implementation 的 Role | 仅 `def_coding_worker` / `sup_coding_worker` | `CODING_ROLES` = `coding_worker` + 旧两键 |
| Review 枚举 | `dispatcher` / `independent` | `manager` / `dispatcher` / `independent` |
| 负面测试 | `scripts/test_workflowctl.py`（153 行） | **无** |

**后果**：两份实现对 `Kind: implementation` 接受的 Role 集合几乎不相交；`Review: manager` 只被插件副本接受。同一份 generation 若被一侧校验、另一侧执行，会在 adopt 或 dispatch 处失败。这与 Host 拒绝旧 coding 角色（`workflow.ts:229`、`:245`）叠加后，会出现「旧合同被 Host 判死、新合同被 skill 判死」的双向堵死。

复检命令（迁移前必跑，确认当前部署的实际分歧）：

```bash
diff "$workflowSkillDir/scripts/workflowctl.py" scripts/workflowctl.py | grep -c '^[<>]'
grep -n 'CODING_ROLES\|roles -' "$workflowSkillDir/scripts/workflowctl.py"
```

### 2.3 信任假设（不变量缺口）

1. **重载不复检**：构造函数直接 `JSON.parse(planSnapshot)` 并 `readFileSync(attempt.contract)`（`workflow.ts:137–144`），快照一次校验后永久信任。
2. **合同文件是派生副本**：Host 由快照写出 `a.contract`（`:893`），但文件可被中途改写；改写后 worker 读到的 prompt 变化，而 Host 只在 `record-result` 时用 Python 重新解析一次（`contract()` 只校验格式，不比对快照内容）。
3. **env 失败路径未格式化**：`DSH_ROLE_PROFILES` 缺失抛 `KeyError`，不在 `main()` 捕获元组内（`workflowctl.py:15` vs `:324`）→ 裸 traceback。

---

## 3. 门的处置清单

判定标准：① 不过门是否产生**静默错误**；② 是否与 Host 侧重复或位置放错；③ 是否产生**误报**或纯作者摩擦。

### 3.1 保留（真门）

| 门 | Python 位置 | 保留理由 |
|---|---|---|
| `scope()` 路径规范化（相对/无 `..`/无通配/无空白） | `:97–102` | owned 路径会变成 `writableRoots`；通配还会让 Host 的字符串前缀 `overlaps()` 静默失配 |
| `within()` generation 逃逸 | `:105–109` | 唯一的安全边界 |
| 必需字段 + 五节非空 | `:114`、`:151–158` | 合同即 worker prompt；空节检测抓截断/撕裂生成 |
| `Kind` / `State` / `Schema` / `Delivery` / `Network` / `Outcome` / `Verdict` 枚举 | `:117`、`:186`、`:168`、`:141`、`:242`、`:251` | 防静默误解释，成本极低 |
| `Role ∈ Profile roles` | `:119` | 否则到运行时才发现配置缺失 |
| 只读角色不得拥有产品写路径 | `:135` | 真权限原则，与 prompt 一致 |
| `generation-N` 命名 + Repository 绝对路径 | `:163`、`:171` | Host 硬依赖该布局；相对路径随 CWD 漂移 |
| **契约 revision == 索引 revision** | `:193` | 防陈旧合同文本被当新合同执行 |
| 结果身份绑定 Task/revision/Attempt/Input/Candidate | `:235–243` | 最核心的防伪门 |
| Lane policy：容量、`initial<=max`、Expand、Bases 白名单、`Max workers` positive | `:283–293`、`:297` | 直接被 Host 消费 |
| `Isolation: worktree` + `Merge method: merge` | `:289–290` | 显式拒绝未实现策略 |
| depends ⊆ 索引 + retired 依赖拒绝 | `:197–200` | 悬空依赖会让 dispatch 永久阻塞 |
| 依赖环检测 | `:205–207` | Host 只查直接依赖，环只能在这里抓 |

### 3.2 保留但需修

| 项 | 问题 | 修法 |
|---|---|---|
| 角色模型双份且分歧 | §2.2 | D1：一份规格 + 生成常量；先统一 `coding_worker` 与 `Review` 枚举 |
| 旧 coding 角色在 `CODING_ROLES` 放行（`:29`、`:121`） | 方向错：adopt 通过、dispatch 才抛 | `contract()` 对 implementation 只认 `coding_worker`；读兼容交给显式迁移路径 |
| `load_role_profiles` 的 env 依赖（`:14–15`） | 缺 env 裸 traceback | 迁 TS 后消失；native 侧保留但纳入错误处理 |
| `read()` 手写 Markdown 解析 + JSON 数组编码（`:36–68`、`:83–94`） | 是 `Plan`/`Task`（`workflow.ts:20–21`）的隐式镜像 | 单一 schema；编码形式在 D1 中一并决定 |
| 无负面测试（插件副本） | 全靠 review 保真 | 见 §9 |

### 3.3 过度设计（删或降级）

| 项 | 位置 | 判定 |
|---|---|---|
| `result-check --review` 分支 | `:244–252`、`:310` | 死代码：Host 只传 `--contract`/`--json`（`workflow.ts:725`），全仓库无调用；与 Host 的 JSON 裁判（`workflow.ts:306–311`）规则不同 |
| `Read paths` 门（必须显式 + `scope`） | `:145–148`、`:149` | `Boundary`（`src/types.ts:5–12`）无读限制字段，reads 只进 prompt 文本（`workflow.ts:889`）→ 强制文档而非行为 |
| 静态并发 ownership 重叠拒绝 | `:216–225` | 与 Host 动态检查（`workflow.ts:856`）重复且更严：两个无依赖任务复用同一路径、靠 lane 容量串行是合理设计，却直接判死 → 误报源 |
| `array()` 重复项拒绝 | `:92–93` | 集合语义，重复无害 |
| Owned paths 归一化重复拒绝 | `:133–134` | 同上，union 语义 |
| 结果文件名规则 | `:240` | Host 自定路径并传绝对路径，只对手工 CLI 有意义 |
| 五节对所有 Kind 一律强制 | `:151` | 调查类也被要求 `Validation`，摩擦大于收益 → 按 Kind 分级 |

---

## 4. 目标架构

### 4.1 一份规格，两个后端

```
docs/contract-spec.json  (或 src/contract-spec.ts 作为唯一源)
  ├─ generated: src/contract/rules.ts     ← DSH 侧 TS 实现直接引用
  └─ generated: scripts/_rules.py         ← native skill 侧 Python 实现引用
```

规格内容：必需字段名、章节名、各枚举值、角色集合与 implementation 允许角色、路径规则开关。
**理由**：分歧的根因是「同一套常量手抄两份」。先把常量生成化，再谈实现语言。

### 4.2 DSH 侧 TS 模块

新增 `src/contract.ts`（纯函数，无 IO 副作用，便于单测）：

```ts
export class ContractInvalid extends Error {}

export interface ContractFields {
  revision: number
  kind: 'investigation' | 'implementation' | 'validation'
  role: string
  depends: string[]; owned: string[]; resources: string[]; inputs: string[]
  review: 'manager' | 'dispatcher' | 'independent'
  lane: boolean; cwd: string
  network: 'disabled' | 'loopback'
  reads: string[]; writes: string[]; reports: string[]; ports: string[]
}

/** Markdown 字段解析；围栏跳过、重复 section/field 拒绝、反引号剥离。 */
export function parseDocument(text: string, source: string): ParsedDocument

/** 单合同校验（对应 contract()）。 */
export function readContract(text: string, roles: ReadonlySet<string>, source: string): ContractFields

/** 整份 generation 校验 + 投影（对应 validate() + export_dsh()）。 */
export function loadGeneration(generation: string, roles: ReadonlySet<string>): Plan

/** 结果身份校验（对应 result_check()，去掉 --review 分支）。 */
export function checkResult(text: string, contractText: string, identity: ResultIdentity): ResultIdentity
```

`Workflow.python()`（`workflow.ts:169–174`）随之删除；`:660`、`:725` 改为进程内调用。

### 4.3 native 侧保形

skill 文档仍指示 `python3 <SKILL_DIR>/scripts/workflowctl.py validate`（`planner-mode.md:36`、`initial-planning.md:27`、`dispatch.md:27`、`dsh.md:44`）。native Codex 不能假设有 Node，因此：

- **保留** Python CLI 与其测试（`test_workflowctl.py` 是该侧唯一的负面覆盖）。
- 其常量改为从 §4.1 规格生成，消除手抄分歧。
- **不要**让 Python 去 shell 调用 Node（会把 Node 依赖带进 native 路径）。

---

## 5. 分阶段计划

### D1 — 统一规格与角色模型（阻塞项，先做）
1. 确定 canonical 角色模型：实现统一为 `coding_worker`；`Review` 统一为 `manager | dispatcher | independent`。
2. 抽出规格文件，生成两端常量。
3. 修掉 skill 副本的 implementation 角色规则与 plugin 副本对齐。
4. **验收**：`diff` 两端常量区为零差异；用同一份 fixture generation 跑两个校验器，结果一致（同过同拒）。
5. **回滚**：规格文件独立，删除生成步骤即回到现状。

### D2 — DSH 侧门迁 TS + 不变量强化（核心）
1. 建 `src/contract.ts`，逐门等价移植 §3.1；同步删除 §3.3 的过度设计项。
2. `workflow.ts:660`、`:725` 改进程内调用，删除 `python()` 与 env 注入。
3. 加 §6 的加载时/派发时/结果时不变量。
4. **验收**：`npm run build` + 全量 `node --test`；`workflowctl.py` 的负面用例全部翻成 TS 用例并通过（§9）。
5. **回滚**：保留 `scripts/workflowctl.py` 一个版本周期，用开关切回子进程路径。

### D3 — native 侧规格生成
1. Python 常量改为生成物，保留 CLI 与 TOML 角色模型。
2. 更新 skill 文档中与 `Review`/Role 相关的格式说明（`references/formats/task-contract.md`）。
3. **验收**：native 路径的 `test_workflowctl.py` 全绿，且与 D2 的 TS 用例共享同一 fixture 集。

### D4 — 清理
1. 删除 §3.3 全部项；`--review` CLI 参数一并移除。
2. 结果文件名规则合并为单条。
3. **验收**：`workflowctl.py` 行数下降、CLI `--help` 不再暴露无调用方参数。

---

## 6. 框架时机触发（本次迁移的真正增值）

原则：**只有 Host 自己拥有、与 agent 是否调用工具无关的不变量，才值得搬到框架时机。**

### 6.1 加载时复检（收益最大、最便宜）
`Workflow` 构造函数（`workflow.ts:137–144`）在 rehydrate 时校验：
- `planSnapshot` 能解析成 `Plan` 且 revision 与磁盘 `plan.md` 一致；
- 每个 `attempt.contract` 的内容哈希等于快照中该 task 的 text 哈希；
- 不一致 → 拒绝加载并给出具体身份（run/task/attempt），不做静默修复。

堵的是「跨 session 之间有人改过 `agentwork/`」。

### 6.2 派发/结果时复检合同哈希
- 快照是唯一真相；`a.contract` 只是派生副本。
- `dispatch` 与 `record-result` 各校验一次「文件内容哈希 == 快照 text 哈希」，不等即拒。
- 这样中途改写合同文件会立刻失败，而不是改变 worker 读到的 prompt。
- 复用同一哈希也顺带取代 Python 的字符串 revision 比对。

### 6.3 结果身份作为 TS 不变量
Task / Contract revision / Attempt / Input snapshot / Candidate snapshot 五点比对全部留在 `checkResult`，纯比较、无子进程、无格式歧义。

### 6.4 明确不搬的
- ownership 重叠、base/ancestor、lane 占用、Git 清洁度：已在 TS 内、时机正确（`dispatch`/`record-result`），保持现状。
- 「agent 不能绕过受管流程」：属 DSH 策略层，另案。

---

## 7. 等价性对照表（实施时逐行核对）

| Python | 规则 | TS 归属 | 处置 |
|---|---|---|---|
| `read()` `:36–68` | 解析 + 重复拒绝 + 反引号剥离 | `parseDocument` | 保留 |
| `required` `:71–74` | 缺字段 | `readContract` | 保留 |
| `positive` `:77–80` | revision/attempt 正整数 | 同上 | 保留（去重复调用） |
| `array` `:83–94` | JSON 数组 + 非空串 | 同上 | 保留，删重复项检查 |
| `scope` `:97–102` | owned 路径安全 | `scopePath` | 保留 |
| `within` `:105–109` | generation 逃逸 | `within` | 保留 |
| `contract` `:112–159` | 角色/枚举/章节/Read paths | `readContract` | 保留，删 Read paths 门，按 Kind 分级章节 |
| `validate` `:162–225` | 计划 + 依赖 + 环 + 静态重叠 | `loadGeneration` | 保留，静态重叠降级为告警或删 |
| `result_check` `:228–253` | 结果身份 + review 分支 | `checkResult` | 保留身份，删 review 分支与文件名规则 |
| `export_dsh` `:257–297` | lane policy 投影 | `loadGeneration` | 全保留 |
| `main` `:300–328` | CLI + 错误格式 | CLI 保形（D3） | 保留，补 env 失败路径 |

---

## 8. 迁移前的必查项（人工确认）

1. **canonical 角色模型的归属**：native Codex 是否仍允许 `def_coding_worker`/`sup_coding_worker` 作为合同 Role？若允许，§4.1 的规格需要区分「native 接受集」与「DSH 接受集」两栏，而不是一刀切。
2. **`workflowSkillDir` 是否随插件版本发布**：若 skill 与本插件分属不同仓库/发布节奏，D1/D3 需要跨仓库协调，落地顺序必须写成「插件先兼容旧角色一个版本」。
3. **是否存在 native 授权、DSH 执行的混合流程**：若存在，§2.2 的双向堵死是现网缺陷，D1 需要提级为 bug fix。
4. **`Review: manager` 的实际使用率**：若 native 侧从未使用，可考虑统一为 `dispatcher | independent` 以缩短分歧面。

---

## 9. 测试计划

**移植现有负面用例**（来源：skill 的 `test_workflowctl.py`，逐条翻成 TS）：
- 缺字段 / 重复 section / 重复 field；
- 非法 Kind / Role / Review / State / Network / Outcome；
- implementation + 非 coding worker；
- 只读角色拥有 owned paths；
- `Inputs` 为空；
- `Lane: no` 缺 `Cwd`；
- owned 路径含 `..` / 绝对路径 / 通配；
- 合同与索引 revision 不一致；
- 未知依赖 / retired 依赖 / 依赖环；
- 结果 Task/Attempt/Input/Candidate 不绑定；
- lane policy 非法（负数、`initial>max`、非 worktree、非 merge、非法 Base）。

**新增不变量用例**：
- 加载时：篡改 `planSnapshot` / 篡改 `attempt.contract` → 构造即拒；
- 派发时：派发前改写合同文件 → `dispatch` 拒绝并指认 identity；
- 结果时：改写合同 revision 后录结果 → 拒绝。

**一致性用例（跨语言）**：
- 同一批 fixture（含合法与非法）分别过 TS 与 Python 校验器，断言「同过同拒」；这是防止再次分歧的回归网。

---

## 10. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 两份实现继续分歧 | 高 | D1 先行；一致性用例进 CI |
| 迁移中改变强制语义，误伤存量生成 | 高 | D2 拆成「等价移植」与「不变量强化」两个提交，前者零语义变化 |
| skill 与插件分属不同发布节奏 | 中 | 插件先兼容旧角色一个版本，再收紧 |
| 删除 `--review` 影响外部手工脚本 | 低 | 全仓库无调用；发布说明标注 |
| Python 依赖移除后 native 路径失效 | 中 | native 保留 Python CLI，不由 Node 驱动 |

---

## 11. 验收标准（Definition of Done）

1. `src/contract.ts` 覆盖 §3.1 全部保留门，且**无子进程**；`Workflow.python()` 与 `DSH_ROLE_PROFILES` 注入删除。
2. §3.3 的过度设计项全部移除，CLI 不再暴露 `--review`。
3. §6.1/6.2/6.3 三条不变量有对应测试，且测试在篡改场景下确实失败。
4. 跨语言一致性用例通过：同一 fixture 集上 TS 与 Python 校验器同过同拒。
5. 全量 `node --test` 通过；native 侧 `test_workflowctl.py` 通过。
6. `README.md` 的 Python 3 依赖描述按实际结果更新（DSH 侧不再需要）。
