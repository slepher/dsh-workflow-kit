# Workflow session gate 执行方案

> 状态：待实现。本文固定实现选择，不要求执行者重新设计架构。
> 基线：2026-09-15 的当前工作树；本机 `codex-cli 0.154.0`。
> 本次交付：workflow 在启动 session 前注册 `role + hook + args`；DSH 原生工具和 Codex 内部工具在受支持的操作执行前调用同一个 DSH 校验函数。

## 0. 已决策事项

1. `role` 只是 workflow 的业务标签，不是 DSH persona、Codex role、模型选择或权限等级。provider 不枚举、不解释这些名字。
2. 规则在 **workflow-kit 的确定性 TypeScript 函数**中执行，不调用模型，不把校验任务委派给 Codex。
3. DSH 原生执行直接复用 `ctx.tools.guard()`；不新建 DSH core gate 服务、不修改 agent-loop。
4. Codex provider 提供具名回调注册及 session 绑定接口，并实现 **同步 command PreToolUse hook → 本机 DSH → allow/deny**。不用审批请求冒充每次操作的回调。
5. 两种执行入口共用 workflow 校验器；provider 只传递信息和决定。
6. 首版只检查已知工具、明确文件操作与明确角色禁令。**不分析任意 shell 程序实际写了哪些文件。**
7. 首版不做 planner 读取量统计、自动告警、命令重写、审批升级或通用策略 DSL。
8. 提交、合并、抛弃、释放仍由已有 workflow 动作处理。新增一个明确的工作流完成检查，不能把正常 idle 等待当作完成。
9. 不执行 `gate-migrate.md` 的 Python → TS 迁移、格式删门、native 角色统一或哈希复检。该文件是此前讨论材料，本文规定本次实施范围。

## 1. 范围与完成含义

### 1.1 范围内

- DSH root manager：在成功 adopt 后启用 manager gate。
- 经 workflow-kit 创建的新子 session，包括普通 `delegate`、受管任务、review、consult、integration repair 及其后继。
- 子 session 使用 DSH 原生模型提供方或 Codex provider 时，应用同一份绑定和规则。
- 已有带 gate 的 session 的恢复、继续、交接及关闭。
- 明确文件工具的产品范围、lane 和已授权公共文档/报告路径检查。

### 1.2 不做

- 不保证覆盖 shell 内部的 `open/write/rename`、解释器、后台进程或任意 MCP 的副作用。
- 不解析 shell AST，不把 `pytest`、`npm test` 等命令字符串做成不断扩大的黑名单。
- 不改变现有 Codex sandbox、approval、network 或 writableRoots 策略；不借本次任务修复所有权限接线问题。
- 不实现 Windows hook IPC；首版真实 Codex 闭环验收在本机 Linux 完成。DSH 原生 guard 不依赖该 IPC。
- 不给未注册的普通 session 自动套上 workflow，不修改旧 native skill 的角色模型。
- 不要求每条工具调用、bootstrap handoff 或 consultation 创建提交。
- 不拦截自然语言“我完成了”，不强制每次 turn 结束都继续，也不自动决定合并/抛弃。

### 1.3 强制范围

本文的“拒绝”指：已覆盖的工具调用在执行前收到 DSH 的 deny，工具执行函数未被调用。它不表示所有进程副作用都受检查，也不表示 Codex 所有特殊执行路径都经过 hook。

DSH 已有的 sandbox 和结果 diff 检查继续生效；本次不新增一套权限系统来弥补明确排除的场景。

## 2. 现有落点与文件责任

以下路径相对 `/home/slepher/project/agents/dsh`。行号仅辅助定位，以符号为准。

| 文件/符号 | 已有能力 | 本次责任 |
|---|---|---|
| `deepseek-harness/packages/core/tools/src/index.ts`：`guard()`、`prepareExecution()` | agent/全局 guard；真实 dispatch 前拒绝 | 只读复用，不修改 |
| `deepseek-harness/packages/hooks/hooks-codex/src/index.ts` | DSH 工具调用 Codex 风格 hook | 只读参考；方向与本次 Codex → DSH 桥不同，不修改 |
| `dsh-workflow-kit/src/host.ts`：`apply()` | 安装 workflow 工具与服务 | 安装 DSH guard、向 provider 注册 workflow hook、增加 complete action |
| `dsh-workflow-kit/src/gate.ts`（新增） | 无 | 唯一业务校验器、DSH 工具适配、路径检查、绑定构造 |
| `dsh-workflow-kit/src/workers.ts`：`create()`、`append()`、handoff/consult 路径 | 保存子身份并启动 native child | 保存绑定；启动前向 provider 登记；后继沿用绑定 |
| `dsh-workflow-kit/src/workflow.ts` | 分配任务、lane、结果、集成、释放 | 根据实际分配构造 gate args；管理 manager 绑定；complete 检查 |
| `dsh-workflow-kit/src/store.ts`、`src/types.ts` | workflow/child 持久化 | 保存和校验可选 gate；兼容旧记录 |
| `dsh-codex-app-provider/src/tool-gate.ts`（新增） | 无 | provider 的公开类型、具名 handler 注册、待启动绑定和 IPC 接收 |
| `dsh-codex-app-provider/src/pretool-client.ts`（新增） | 无 | hook command；只做 stdin/IPC/stdout 转换 |
| `dsh-codex-app-provider/src/index.ts`：`apply()` | provider Host 服务安装 | 提供 `ctx.codexToolGate`、创建/释放桥、导出类型 |
| `dsh-codex-app-provider/src/backend.ts`、`src/rpc.ts` | App Server 生命周期 | 在 runtime 启动前绑定 gate 环境；回调身份映射；恢复和关闭 |
| `dsh-codex-app-provider/src/browser-types.ts`、`src/store.ts`、`src/provider.ts`、`src/handoff.ts` | session options、恢复、后继 | 记录 provider 接收的 gate 副本；避免恢复/交接丢失 |
| 两包 `README.md`、workflow 内置 prompt | 执行说明 | 说明覆盖范围、安装前置、manager 完成操作 |

不修改 `dsh-subagents-codex` 或 `dsh-codex-kit-backend`：它们不是 workflow-kit 当前使用的 provider。不要从它们复制整套权限实现。

## 3. 固定接口

### 3.1 Provider 公开接口

类型定义与 service declaration merging 放在 provider 的 `src/tool-gate.ts`，由 `src/index.ts` 导出。workflow 通过已有 provider 依赖导入，不创建共享 npm 包。

```ts
export type GateBinding = {
  role: string;
  hook: string;
  args: Record<string, unknown>; // 仅 JSON 数据
};

export type GateEvent = {
  source: 'dsh' | 'codex';
  sessionId: string;             // DSH session id，由 Host 确定
  callId: string;
  cwd: string;                   // 受信 session/operation cwd
  toolName: string;
  toolArgs: unknown;             // 保留完整原始参数
};

export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string };

export type GateHandler = (
  binding: Readonly<GateBinding>,
  event: Readonly<GateEvent>,
) => GateDecision;

export interface CodexToolGate {
  register(hook: string, handler: GateHandler): () => void;
  bind(sessionId: string, binding: GateBinding): void;
}
```

固定语义：

- `register` 是 Host API，不注册为模型可调用工具；同名重复注册报错，disposer 删除本次注册。HMR 通过已有 effect 生命周期清理。
- `bind` 接收 **DSH session id**，内部复用 provider 的 `nativeSessionId()` 转换；不让调用方传 Codex thread id。
- `bind` 在首次启动前调用。深拷贝并校验 JSON 数据、非空 role/hook；不可序列化值拒绝。
- 同 session 相同绑定重复登记是幂等操作；不同绑定拒绝，要求新 session。不提供运行中修改 args 的 API。
- 未创建 provider record 时暂存绑定；`createSession` 消费它并随 `StoredSession.options.gate` 保存。已有 record 则校验与已保存绑定一致。
- `bind` 时 hook 未注册直接报错；后续执行时 handler 消失则 deny，不退回普通 session。
- provider 不认识角色集合、lane、任务字段，也不实现路径政策。
- 校验函数保持同步；只有 Codex 到 DSH 的通信是异步等待。不创建异步业务规则链。

### 3.2 为什么不用 `AgentOptions.execution.gate`

本次选择 Host 侧 `bind(sessionId, binding)`，不扩展 DSH 原生 execution 格式。当前 execution 有自己的归一化、冻结和恢复语义，只添加一个结构类型不能证明新字段完整穿透。

workflow 已在启动前选定稳定 child id，足以先登记再启动。保留现有 `execution.boundary` 传递方式，不改 DSH core/session 格式。

### 3.3 Workflow 参数

```ts
type PathGrant = { path: string; kind: 'file' | 'directory' };

type WorkflowGateArgs = {
  cwd: string;
  lane?: string;
  productWrites: PathGrant[];
  auxiliaryWrites: PathGrant[];
  sharedWrites: PathGrant[];
};
```

- 所有 path/cwd/lane 在注册时解析为绝对路径。
- `productWrites`：当前 assignment 明确拥有的产品文件/目录。有 lane 时必须全部在该 lane 内。
- `auxiliaryWrites`：明确分配的临时输出、构建输出、报告与 artifacts。不得自动加入仓库根目录或整个 lane。
- `sharedWrites`：明确分配的公共控制文档。默认空；不因为路径包含 `docs`、`agentwork` 就放行。
- 文件授权只匹配该文件；目录授权匹配该目录及其后代。
- 现有路径用实际文件类型确定 grant kind；尚不存在的 Owned/Write 路径首版按 `file`。需要新目录时由 Host 在分配阶段创建目录后再登记，不能把未知文件路径猜成目录。
- args 不包含函数、模型配置或 approval 策略。

唯一业务 handler 名称为 `workflow.preToolUse`。不做按 role 自动发现 hook，不生成常量或 schema。

## 4. 规则清单：执行者直接照表实现

### 4.1 角色与工具

| 调用者 | 操作 | 决定 |
|---|---|---|
| 未注册 session | 任意操作 | 本 gate 不参与；保留其他已有检查 |
| manager | DSH `bash`、`pwsh`；Codex `Bash`、`exec_command`、`shell`、`shell_command`、`write_stdin` | deny：让对应 worker 执行 |
| manager | 明确文件写操作 | 只允许 sharedWrites/auxiliaryWrites；productWrites 必须为空 |
| manager | `codex_workflow` 的已有动作与 `complete` | 通过本 gate，动作自身继续执行已有检查 |
| 已注册子 session | DSH `subagent`、`send_message`、`interrupt_agent`；Codex `spawn_agent`/`Agent`、`send_message`、`resume_agent`、`close_agent` | deny：子任务调度由 manager/Host 负责 |
| coding worker | 明确文件写操作 | 按 §4.3 检查 |
| planner、reviewer、context_collector、evidence_runner、full_tester | 明确文件写操作 | productWrites 为空；只允许明确辅助/文档授权 |
| worker/planner/reviewer | shell | allow；不解析其中的文件副作用，既有 sandbox 继续处理 |
| 任意已注册 session | 只读文件操作或其他未列工具 | 本 gate allow；不声称覆盖未知工具的副作用 |

说明：

- manager 禁的是整个已知 shell 工具入口，不靠识别某个测试命令。
- persistent bash/pwsh 的公开工具名也是 `bash`/`pwsh`，同样拒绝。
- DSH 子任务工具按默认注册名检查；`list_agents` 是只读查询，不拒绝。首版不发现用户自定义 `subagent.toolName` 别名，部署说明列出这一覆盖限制。
- 不过滤 DSH 的程序化工具调用展示载体；检查其中最终调用的实际工具。具体工具不会因为包在代码模式中而跳过 gate。
- 不调用 `tools.restrict()` 注册可能尚未安装的工具名；本次统一使用 guard 判断实际到达的名称。
- 普通 delegate 仍没有自动提交/合并要求；它只获得 role 与文件操作 gate。
- 首版不加 planner 读取告警。skill 继续要求先用 evidence_runner/collector 定位，再定点阅读。

### 4.2 已知文件工具参数适配

| 来源/工具 | 写目标提取 |
|---|---|
| DSH `write` | `toolArgs.file_path` |
| DSH `edit` | `toolArgs.file_path` |
| DSH `str_replace_editor`，`command === 'view'` | 只读，直接通过 |
| DSH `str_replace_editor`，`create`/`str_replace`/`insert` | `toolArgs.path` |
| Codex `apply_patch` | `toolArgs.command` 中的 patch；提取 Add/Update/Delete/Move 的全部路径 |

固定拒绝：已知文件写工具缺路径、路径非字符串、已知 editor 的未知 command、patch 不能提取出完整操作集合。

Codex patch 仅支持现有 `*** Begin Patch` / `*** End Patch` 格式：

- `*** Add File: P`：检查 P。
- `*** Delete File: P`：检查 P。
- `*** Update File: P`：检查 P。
- `*** Move to: Q`：同时检查前述 Update 的 P 与 Q；没有对应 Update 则拒绝。
- diff 内容行不是路径指令；不能搜索内容中任意出现的文件名。
- 一份 patch 任意路径不允许，拒绝整次调用，不能先应用其中一部分。
- 不支持从 shell 字符串中寻找嵌套 patch。该场景属于 shell 不检查范围。

### 4.3 路径算法

按以下顺序，不增加模糊匹配：

1. 将工具相对路径按 `event.cwd` 解析为绝对路径；不用 Node 进程的 CWD。
2. 检查 event.cwd 对应已绑定的 assignment cwd。对文件工具若执行上下文与绑定不一致，拒绝并报告两者；不自动改写 cwd。
3. 对目标及 grant 使用现有 `scoped()` 的“最近存在祖先 + realpath”方法检查符号链接。抽出可复用小函数，保持原有调用语义；不存在的尾部逐段接回。
4. 同时要求词法路径和解析后的真实路径均属于同一项 grant。目录比较使用 `relative()`/路径分隔符，不能用裸 `startsWith()`。
5. productWrites 还必须满足 lane（有 lane 时）的两种包含检查。
6. auxiliaryWrites/sharedWrites 可以位于 lane 外，但必须命中自己明确的 grant；绝不能靠产品授权顺带放行。
7. 检查只决定该工具调用是否放行。不创建目标文件，不修复 symlink，不扩大授权。

复用或移动现有路径函数即可；不增加通用路径解析库。检查与实际写入之间的文件替换竞态不在首版保证范围。

## 5. Workflow 如何构造和保存绑定

### 5.1 子 session

`NativeChildRecord` 增加可选 `gate?: GateBinding`。新 workflow 创建的子 session 必须有该字段；旧记录允许缺失。

顺序固定为：

1. 完成现有 assignment/lane/report 分配，并完成现有 worktree 创建/checkout。路径 grant 的归一化放在工作目录实际存在之后；不能先创建 lane 内文件再运行 `git worktree add`。
2. 构造 gate，深拷贝保存到 `NativeChildRecord`。
3. 若本次 provider 是 Codex，调用 `ctx.codexToolGate.bind(childId, gate)`。
4. 调用现有 `startContinuable`/后继启动入口。

DSH guard 从 workflow store 按真实 `exec.agent.session.id` 查绑定；不依赖 execution 自定义字段，也不从 prompt 推断 role。

| 创建位置 | productWrites | auxiliaryWrites/sharedWrites |
|---|---|---|
| 正常受管 coding task | `Owned paths` 相对实际 cwd 解析；禁止用 `[lane.path]` 替代 | 已声明 Write paths、具体 reportPaths、该 worker artifacts |
| 非 coding 受管 task | 空 | 该 assignment 明确的报告、artifacts、辅助写路径 |
| 普通 coding delegate | 现有 `writes` 逐项转换为 grant；无 lane | 不增加隐式授权 |
| 普通非 coding delegate | 空 | 现有明确 `writes` 放入 sharedWrites；不推断更多可写位置 |
| task/integration reviewer | 空 | 自己的 artifacts；不授权整个 results 或产品目录 |
| consultation | 空，即使 role 标签仍为 coding_worker | 自己的 artifacts |
| integration repair | 当前已有 resolved 检查所用的 source/target 变更路径并集，按具体文件授权 | 自己的 artifacts |

注意：

- `Role: coding_worker` 不等于一定能改产品；consultation 的 productWrites 仍为空。
- integration repair 在派发时提前计算并冻结允许路径并集，复用 `paths()`。执行后的 `resolved` 检查继续保留。
- `reports` 用具体报告路径生成授权；不要仅因存在一份报告就把整个 results 目录授予所有写入。
- Git 提交由现有 shell 路径完成。本 gate 不把 Git 元数据添加为文件编辑授权，也不改现有 sandbox 的 Git roots。
- 公共文档沿用“一文件一 writer”：manager 默认只拥有当前 generation 的 `summary.md`；planner 的计划文档通过明确 assignment 授权。新登记的 sharedWrites 若与未关闭子 session 或 manager 的 sharedWrites 重叠，拒绝该分配，复用现有 overlap 语义，不做第二套锁服务。

### 5.2 manager

- 在 `adopt` 成功后，按 run.parent 派生 manager 绑定：role=`manager`，cwd=repository，productWrites=[]，sharedWrites 仅当前 generation 的 `summary.md`。
- 不把 planner 的 plan/tasks/contracts 授给 manager。
- manager 绑定由当前 run 派生，不新增持久化表。每次 guard 查当前 run；adopt 新 revision 后自然使用更新的 run。
- `delegate` 不隐式把尚未 adopt 的父 session 变成受管 manager。
- 本次 root manager 指 DSH 自有工具执行路径。不要新增“在已经运行的 Codex root turn 内热装 gate”的能力；Codex session 的 gate 必须在首次启动前登记。

### 5.3 恢复、交接与旧数据

- Host 安装：将 `codexToolGate` 加入 workflow 的现有 inject 列表；先注册 `workflow.preToolUse` 和 DSH guard，再允许新的 workflow 工具启动 session。当前 workflow 已依赖 codexExecution，不在本次拆除 provider 依赖。
- provider 关闭后重启：workflow 用已有 `NativeChildRecord.gate` 重新登记；provider 的 options.gate 必须与之相同。
- bootstrap/cross-provider handoff：后继保存原 gate 的深拷贝；新的 DSH sessionId 独立登记。task 范围不因 tier/provider 改变。
- 同一 Codex thread 换 DSH owner 时，旧 runtime 的回调身份失效，新 runtime 绑定后继。不得按 hook 中的 `session_id` 字符串猜测 owner。
- 普通 continuation 使用原绑定；合同范围改变走已有新 assignment/session，不热改 gate args。
- 已关闭、已交接出去的 session 拒绝新的 gate 请求。
- 旧记录没有 gate：保留旧行为，不猜测历史范围；下一次新建子 session 使用 gate。status 必须能区分该 session 未启用 gate，不能显示为已受 gate 保护。
- 注册项/IPC 的释放必须随插件 effect 和 runtime 生命周期完成；不创建轮询清理器。

## 6. DSH 原生适配

在 workflow `host.ts` 安装一个全局 `ctx.tools.guard()`，内部按 session 过滤：

1. 没有 `exec.agent`：本 gate 不参与。
2. 验证 agent 是当前注册的 live agent，session 是当前注册的 session；复用现有 Host identity 检查方式。
3. 查 child gate；没有则查已 adopt manager 绑定；两者都没有则返回 undefined。
4. 从 `exec.name`、完整 `exec.arguments`、callId 和实际 agent/session cwd 构造 GateEvent。
5. 调用唯一 workflow handler；deny 返回 reason，allow 返回 undefined。

guard 是单调拒绝机制，不能覆盖其他 guard 的拒绝。不手动调用 `ctx.tools.execute()` 模拟一次原调用，不重复执行，也不绕过工具原有 sandbox。

不使用现有 hooks-codex 的 payload 构造器：它有只取 command 的路径，会丢失 write/edit 的文件参数。

## 7. Codex → DSH 桥：固定采用 command hook + Unix socket

### 7.1 不采用的路线

- 不使用 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval` 充当通用前置事件；它们不是每次操作都会发出。
- 不用 `item/started`、`item/completed` 等通知来实现否决。
- 不采用 MCP hook 作为首版运输层：官方明确服务缺失/错误时不阻断。
- 不假定 `thread/start.config` 的任意 hook 对象天然受信；hook 配置按 §7.2 预先部署。

### 7.2 Hook 部署

provider 构建后包含 `lib/pretool-client.js`；现有 package `files: ["lib", ...]` 可直接包含，不新建插件包。

在 provider README 提供固定的 **managed `requirements.toml`** 配置模板，使用部署机 Node 和 client 文件的绝对路径：

```toml
[features]
hooks = true

[[hooks.PreToolUse]]
matcher = ".*"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "<absolute-node> <absolute-provider>/lib/pretool-client.js"
timeout = 10
```

执行要求：

- 路径有空格时按该部署 shell 正确引用；生成/打印模板时使用真实路径，不把占位符交付为已部署配置。
- 将条目合并到部署已使用的受管 requirements 配置，保留现有 features/hooks；不覆盖整个配置，不设置会移除其他 hooks 的选项。
- client 安装在 provider 的部署位置，不放进 worker lane。
- 安装/信任配置属于部署步骤；执行实现时先产出模板和可运行 client。没有修改部署配置权限时报告该具体部署前置未完成，不把 mock 测试记为真实接入成功。
- 不修改用户的认证配置，不创建新的 CODEX_HOME，不自动升级 Codex，不 fork Codex 源码。
- 未受管普通 hook 可能因为信任检查被跳过，因此不能替代该受管部署验收。
- 全局 hook 对没有下述启用标记的 Codex 进程直接退出 0，不发送 IPC、不改变普通 session。

官方依据：[Hooks 配置与 managed hooks](https://learn.chatgpt.com/docs/hooks)。真实可用性以 §10 的已安装版本实验为准。

### 7.3 Runtime 与 IPC

- provider 使用 Node `net`，在临时目录创建一个 Unix socket；目录权限 0700、socket 0600。关闭时删除自己创建的 socket/目录。
- 复用 stdlib，不引入 HTTP 服务、数据库、队列或新 npm 依赖。
- 每个带 gate 的 App Server runtime 生成一个不持久化的随机 runtime key，绑定到当前 provider record。重启、交接后旧 key 失效。
- `AppServer` 的 spawn options 增加可选 env；保持 process.env，再仅向带 gate 的 runtime 注入：

```text
DSH_PRETOOL_ENABLED=1
DSH_PRETOOL_SOCKET=<socket path>
DSH_PRETOOL_RUNTIME=<opaque runtime key>
```

- 没有 gate 的 runtime 不注入以上变量。gate 不能从传入工具参数、prompt 或文件内容中登记。
- wire 格式固定为一连接一请求/响应，UTF-8 单行 JSON：`{ runtime, event }` → GateDecision。
- event 是原始 Codex hook stdin；client 不携带 role、args，不执行 workflow 规则。
- IPC 收到 runtime key 后，从活跃 record 取得 DSH sessionId、gate 和 execution cwd。hook 的 session_id 只用于诊断，不能替代映射；turn_id 若已能与当前 record 对照则检查一致。
- 拒绝未知/失效 runtime、无绑定、handler 缺失、已关闭/已交接身份以及结构非法的请求。
- Codex `turn/started` 与 `turn/start` 回复可能有先后差异；沿用 backend 已有事件状态归并，不因为回复尚未到达而误拒绝合法首个 hook。
- receiver 在当前 DSH 进程直接调用 handler，不调用模型，不经 `Workflow.execute()` 队列，不等待当前 agent turn 结束，避免自身等待自身。
- 不向 `tools/pre-execute` 伪造一个不存在的 DSH ToolExecution；直接调用相同 GateHandler 即可。

具体接线：将 backend 的 transport factory 从无参函数扩为接收可选 `{ env?: NodeJS.ProcessEnv }` 的函数；在创建 runtime 的 `attach(record)` 中先取得 gate runtime 环境再调用 factory，`index.ts` 将该 env 传给 `new AppServer(...)`。`runtime(record)` 复用已有 runtime 时不创建第二个 key。无 gate 时传 undefined，保留原 spawn 行为；已有 fake transport factory 可以忽略该可选参数。`readWithTemporaryServer()` 的只读临时 RPC 继续不带 gate 环境，不能用于执行 gated turn。不要修改全局 `process.env`。

### 7.4 Client 返回与错误

- 没有 ENABLED 标记：退出 0，无输出。
- ENABLED=1 但地址/key 缺失、stdin 非法、IPC 连接失败、无效返回：输出有效 deny JSON，退出 0。
- IPC 超时固定 3 秒，短于 hook 的 10 秒；超时同样输出 deny。没有自动重试、没有审批 fallback。
- 只有明确的 `{kind:'allow'}` 才输出 allow。

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "workflow gate: write outside assigned paths"
  }
}
```

允许使用同样结构的 `permissionDecision: "allow"`。不输出 `ask`、`continue:false` 或 `updatedInput`。client 的 stdout 只输出协议，诊断到 stderr，不打印 runtime key。

命令程序本身未启动/被 Codex 跳过时，本桥无法返回 deny；这是明确的运行前置和真实测试项目，不通过增加另一个权限系统解决。执行者必须先完成部署与真实 hook 验收，再在该部署上启用新的 gated Codex assignment；不能把“未观察到 hook”解释为 allow，也不能静默去掉 gate 重试。不声称 provider 已能从 App Server schema 自动证明 hook 已加载。

### 7.5 Provider 生命周期接线

- `ctx.codexToolGate` 是独立的 Host capability；不把可变注册方法塞进只读的 `codexExecution`。
- 新 session：workflow `bind` → backend 保存 options.gate → 建立 runtime key/env → thread/start → turn/start。
- resume/restart：读取原 options.gate，确认 handler 在，再创建新的 key/env；未登记的新 gate 不得在已有运行中的 thread 上临时生效。
- handoff：保留绑定到后继 options；采用当前后继 runtime 启动流程重建回调映射。旧 key 不得作用于后继。
- provider 的 `recordedExecution()` 不要因为新增 gate 而把它塞入 DSH 原生 LlmExecutionOptions；gate 通过自己的 Host 注册/持久化路径恢复。
- 普通模型、effort、approval 的用户设置保持现有语义，不让 gate 偷换这些配置。

## 8. Workflow 完成与 lane 处置

新增 `codex_workflow action=complete`，只做确定性检查，不自动 Git 操作：

1. 当前 run 中任意 attempt 未 released：拒绝，返回 task/attempt/state 及已有下一动作。
2. 当前 run.plan.tasks 中每个 executable task，必须存在同 revision、`state === 'released'`、`discarded !== true` 且带 candidate/result 的 attempt；缺失则拒绝。现有 release 只接受 delivered/archived，而 archive 设置 discarded，因此该条件可复用既有状态保证。不要要求 `integration.delivered` 必然存在：no-code 交付和候选已在 target 中的快速路径没有 integration。
3. 当前 run 仍拥有 lane，或其子 session 尚未按已有 release 逻辑关闭：拒绝。
4. 全部满足：返回 `{ complete: true }`；无变更副作用，不新增 completedAt 或另一个状态机。后续 adopt 新 revision 后重新计算。

补充 `status` 的 `complete` 与 `pendingDisposition`，调用同一检查函数，不能复制一套判断。

边界：

- 此检查覆盖 Host 已采用的 executable task 和运行资源；不宣称替代 whole-goal 人工判断，当前 Plan 不保存的 draft 任务不凭空推断。
- `archive` 仍按现有 reviewer disposition；不让 manager 绕过 review 自行丢弃。
- 启动其他独立任务不以“所有 lane 都空闲”为条件。
- 正常等待 worker、review、consult 或用户决定时允许 turn 结束；只禁止把未交付/未处置状态通过 complete。
- manager 的内置说明要求最终报告工作流完成前调用 complete。不得用文本分类器分析 final answer，也不安装无限继续的 Stop hook。

## 9. 实施顺序与每步交付

每一步通过指定检查后再进入下一步。以下是本方案中的实现批次，不是要求产品任务每个内部步骤提交合并。

### P0：确认运行前置

1. 记录两个包 git status，保留现有未提交内容；当前 `gate-migrate.md` 可能是未跟踪文件，不删除。
2. 读取两包 manifest、当前安装的 DSH tools 类型，确认 `guard()` 可调用。缺失时报告协调依赖版本不满足；不临时实现第二套 core guard。
3. 运行 `codex --version`、`codex app-server --help`；必要时向 `/tmp` 生成 schema，不写仓库生成目录。
4. 确认部署具备受管同步 PreToolUse 配置来源。产出真实路径的安装模板；hook 未加载不能进入“Codex 真实闭环已完成”的验收状态。
5. 不为能力不满足自动升级依赖或改 Codex 源码。可继续完成不依赖它的 DSH 原生实现。

### P1：绑定与唯一校验函数

1. provider 新增公开类型/registry/bind 接口和 options.gate 持久化。
2. workflow 新增 gate.ts，按 §3–4 实现绑定构造、文件工具提取、路径判断及 manager 禁令。
3. store 增加可选 gate 校验，旧记录继续可读。
4. 增加表驱动单测，覆盖 §10 的规则组；测试“哪些文件获准”，不逐行镜像实现。

### P2：DSH 原生接入

1. host 注册 guard；按 §5 在所有子 session 创建点保存 gate。
2. 非 Codex child 不调用 provider.bind，直接由 DSH guard 查 store。
3. adopt 后启用 manager gate。
4. 使用真实 DSH tools registry 测试：被拒绝的工具执行函数调用次数为 0；允许调用为 1；PTC 下最终工具也被检查。
5. 验证 disposer 卸载、未绑定 session 无影响。
6. 更新现有 native/Host fixture，提供新的 codexToolGate Host service；测试替身必须记录 bind 发生在子 session 首次启动之前，不能只添加一个无行为空对象满足 inject。

### P3：Codex 同步回调桥

1. 实现 tool-gate.ts 的 socket 接收与 runtime 映射、pretool-client.ts 协议程序。
2. 接入 rpc.ts 的 spawn env 和 backend 生命周期。
3. workflow 在 Codex child 启动前调用 bind。
4. 测试 client 实际子进程与 socket 往返，不仅测试 JSON 转换函数。
5. 完成真实 Codex hook 的 deny/allow 实验；未达到条件时明确留下阻塞项，不宣称完成。

### P4：恢复与交接

1. 补 provider options.gate 的恢复、关闭、handoff；失效 runtime key 拒绝。
2. 补 workflow successor/consult/integration call sites 的 gate。
3. 验证同 provider bootstrap 和 cross-provider 后继都继承相同范围。
4. 验证 legacy session 未绑定不受新 gate 影响，不伪报已保护。

### P5：收尾与文档

1. 增加 complete 动作及 status 结果，复用同一完成检查。
2. 更新 host 工具说明、worker-execution/planner 相关内置说明及 README：规则在 Host，不要求 agent 自己运行 gate 脚本。
3. 明确 shell 分析、planner 读取告警和 hook 特殊路径不在覆盖范围。
4. 按 §11 完成测试与打包内容检查，给出最终修改列表、测试证据和部署状态。

## 10. 固定验收用例

### 10.1 规则测试：`dsh-workflow-kit/test/gate.test.mjs`

| ID | 输入/场景 | 预期 |
|---|---|---|
| G01 | lane/src/a.ts 获授权；编辑该文件 | allow |
| G02 | 同 lane/src/b.ts 未获授权 | deny |
| G03 | 名称前缀相同的 lane-other 或 src-old | deny |
| G04 | `../` 解析后离开授权范围、绝对外部路径、symlink 指向外部 | deny |
| G05 | 新文件命中 exact file grant | allow；相邻新文件 deny |
| G06 | patch 多文件，只有一个越界 | 整次 deny，执行函数未运行 |
| G07 | move 源获准、目标越界；反向场景 | 均 deny |
| G08 | 删除获准文件；删除未获准文件 | 分别 allow/deny |
| G09 | 公共 summary 获明确授权；其他公共文件未授权 | 分别 allow/deny |
| G10 | str_replace_editor view；create/insert/replace | view allow；写操作检查 path |
| G11 | manager bash/pwsh/persistent shell | deny |
| G12 | manager codex_workflow status/dispatch/integrate/complete | gate allow，继续由动作处理 |
| G13 | coding_worker consultation，仅有 artifacts | 产品文件 deny；自己 artifacts allow |
| G14 | worker shell，含任意脚本 | 本 gate allow；测试名明确这是已排除检查 |
| G15 | 未绑定 session | 不新增拒绝 |
| G16 | 已知写工具参数缺失/非法；未知工具 | 前者 deny；后者无额外限制 |
| G17 | sharedWrites 与另一未关闭 writer 重叠 | 分配拒绝；关闭后可重新分配 |

### 10.2 Provider 规则运输：`dsh-codex-app-provider/test/tool-gate.test.mjs`

- 相同 bind 幂等；不同 bind 拒绝；不可序列化 args 拒绝。
- provider 接受任意非空 role 标签，不引入 coding_worker 枚举。
- DSH handler 返回 deny 时，client 输出有效 PreToolUse deny。
- DSH handler 抛错、被卸载、socket 断开、超时、非法响应均 deny。
- 未启用 client 不访问 IPC；已启用但缺少 socket/key 不得 no-op。
- 假冒/过期 runtime key、交接前旧 key 均拒绝。
- payload 自报 role/args/session 不能替换 Host 绑定。
- 并发两个 session 的请求命中各自 handler args，不串 lane。
- client 不打印密钥；socket/runtime 关闭后资源释放。
- session store 往返保留 gate；普通 session 无 gate 时参数与行为不变。

### 10.3 两条真实执行链

**DSH 原生：** 在现有 native fixture/Host 测试中挂真实 tools registry，执行 write/edit/bash 测试工具；验证拒绝发生在执行函数前。不要只直接调用 evaluate 函数当作集成测试。

**Codex：** 新增 `test/integration-gate.test.mjs`，仅在显式 `DSH_GATE_LIVE=1` 时运行；使用当前已安装 Codex 与现有测试部署方式，不将 fake App Server 标成真实 Codex。

真实 Codex 用临时测试 workspace，仅运行下列已授权测试操作：

1. 允许编辑一个指定测试文件，确认实际落盘。
2. 请求编辑未授权相邻文件，确认 DSH 收到操作、返回 deny、文件未变。
3. 请求一条会创建 marker 的 Bash；测试 handler 固定 deny，确认 marker 不存在。
4. 停止测试 DSH socket 或让 receiver 超过 3 秒，确认 client 产生 deny，marker 不存在。
5. resume 同一 thread 再做 deny，确认绑定仍在。
6. 将 hook 配置置为未加载/程序不存在，记录真实行为；它属于不满足部署前置的场景，不得记录为已覆盖的强制拒绝。

报告必须区分“hook 已调用且 DSH 拒绝”与“Codex 根本没有尝试工具”。每例保存 hook 收到事件、DSH 决定及文件/marker 结果。用例未触发目标工具是未完成，不算通过。

不要求穷尽所有 Codex/MCP 工具，不要求证明任意 shell 内部写入被拦。首次闭环只需 Bash + apply_patch。

### 10.4 生命周期与完成

- gate 在 child 首次调用前已保存/注册。
- 普通 continuation、bootstrap successor、cross-provider successor 使用原 args。
- 不同合同 revision 的新 session 不复用旧 gate。
- 不带 gate 的旧记录恢复成功；状态明确未启用。
- 有 candidate/accepted/blocked/unknown 等未释放 attempt 时 complete 拒绝。
- discarded + released 不能满足该 task 的交付。
- 所有当前任务交付且释放后 complete 成功。
- 等待运行中 child 的 manager 可正常 idle，无 Stop 循环。
- complete 检查不自动执行 commit、merge、archive 或 release。

## 11. 检查命令与产物

以下命令逐个在注明目录执行，不在 workspace 根目录执行全仓构建。

### Provider：`dsh-codex-app-provider/`

```bash
npm run build
npm run typecheck
node --test test/tool-gate.test.mjs test/backend.test.mjs test/provider.test.mjs test/thread-handoff.test.mjs
npm test
```

新增显式真实实验命令：

```bash
DSH_GATE_LIVE=1 node --test test/integration-gate.test.mjs
```

真实测试默认不开启；但本功能最终验收必须有一次开启后的 Bash/apply_patch 闭环结果，不能用 skipped 代替。

### Workflow：`dsh-workflow-kit/`

```bash
npm run build
node --test test/gate.test.mjs test/workflow.test.mjs test/delegate.test.mjs test/handoff.test.mjs
npm test
```

若新增类型需要本地 provider 新构建产物，使用两个包既有 coordinated tarball / `prepare:local` 流程；只更新实际需要的本地依赖产物，不升级 DSH，不直接篡改 node_modules，也不改另一份旧 provider。

最终核对：

- provider 打包包含 `lib/pretool-client.js` 及 service/types 导出。
- 两包 README 的安装模板、启动顺序、覆盖范围与实现一致。
- 没有新 npm 依赖、通用 gate 包、Python 门迁移或 core agent-loop 改动。
- 工作树保留执行前已有改动。
- 报告列出实际测试命令及退出码；真实 Codex 未配置好时明确“DSH 原生完成 / Codex 接入未验收”，不得标记整项完成。

## 12. Definition of Done

- [ ] workflow 以 `role + hook + args` 绑定新 session，provider 不解释 role。
- [ ] DSH guard 与 Codex hook 调用同一业务校验函数，无模型校验调用。
- [ ] 明确文件工具在越界时未执行；manager 的已知 shell 工具被拒绝。
- [ ] 普通未绑定 session 行为不变；旧记录可恢复。
- [ ] 恢复、继续、handoff 不丢 gate，不串 session。
- [ ] Codex client 的 DSH 通信失败转为明确 deny；部署前置与未覆盖路径有准确说明。
- [ ] complete 拒绝未交付/未处置资源，允许正常 idle 等待。
- [ ] 两包相关测试通过；真实 Codex Bash/apply_patch 往返至少各验证一次。
- [ ] 没有实施本方案明确排除的 shell 分析、planner 读取统计、权限重构或 Python 校验迁移。

## 13. 资料索引

- [Codex Hooks：同步 PreToolUse、返回协议、覆盖例外、managed 配置](https://learn.chatgpt.com/docs/hooks)
- [Codex App Server：thread 生命周期与审批请求](https://learn.chatgpt.com/docs/app-server)
- [DSH 工具执行与 guard](../deepseek-harness/packages/core/tools/src/index.ts)
- [当前 provider thread 参数与审批入口](../dsh-codex-app-provider/src/backend.ts)
- [workflow 子 session 创建与交接](src/workers.ts)
- [workflow 任务、lane、集成和释放](src/workflow.ts)
