# dsh-workflow-kit

一个 DSH（DeepSeek Harness）插件：负责工作流角色与 Profile、任务契约、lane、验收、集成与发布，并把 Codex 执行委托给 `dsh-codex-app-provider`。

[English](README.md) | 中文

- [概述](#概述)
- [环境要求](#环境要求)
- [安装](#安装)
- [配置与 Profile](#配置与-profile)
- [策略](#策略)
- [Session 门禁与写权限](#session-门禁与写权限)
- [工具与客户端界面](#工具与客户端界面)
- [兼容性](#兼容性)
- [开发](#开发)
- [验证面向模型的接口](#验证面向模型的接口)
- [当前验证状态](#当前验证状态)
- [许可证](#许可证)
- [相关仓库](#相关仓库)

## 概述

`dsh-workflow-kit` 是 DSH（包作用域 `@deepseek-ai/dsh-*`）的 Cordis 插件，用于运行任务契约式工作流：采纳一个 plan 作为一个 generation，把任务派发到 git lane，记录并评审结果，集成候选，并准备与完成发布。编排状态、角色目录、写权限以及决定 worker 能做什么的预执行门禁都由本插件负责。

本包分为两半：

- **Host 半部分**（`lib/index.js`）：注册 `codex_workflow` 工具，安装工作流 Session 门禁，提供浏览器 profile 通道，并持久化工作流状态（run、lane、native child 绑定、Session 选择）。
- **客户端半部分**（`./client`，打包为 `lib/client.js`）：在输入框加入配置选择器，并在 DSH 设置中加入 Workflow 页面。

Codex 执行不由本包实现。子 Session 是通过 `ctx.subagents` 创建的 DSH 原生 subagent；执行引擎、原生子会话事实和 `codexToolGate` 能力由 Codex provider 提供（`src/workers.ts`、`src/types.ts`）。provider 必须先于本插件加载：本插件注入 `codexExecution` 与 `codexToolGate`（`src/host.ts:26`），若安装的 provider 未发布 gate，挂载会以明确错误失败，而不是启动一个不受门禁约束的子会话（`src/host.ts:166`）。

## 环境要求

| 要求 | 取值 | 来源 |
| --- | --- | --- |
| Node.js | `>=22.19.0` | `package.json` 的 `engines.node` |
| Python 3 | `PATH` 中的 `python3` | `src/workflow.ts:195` 调用 `python3 scripts/workflowctl.py` |
| Git | `PATH` 中的 `git` | `src/workflow.ts:213` |
| `dsh-codex-app-provider` | `0.1.1`，且先加载 | `package.json` 的 `peerDependencies` |
| DSH 版本 | `0.1.7-rc.2` 与 `0.2.0-rc.2` | `package.json` 的 `dsh.compatibility.dshReleases` |

Python 3 与 Git 是运行时要求，而不只是构建要求：采纳 generation 时导出 plan、以及校验已记录结果时都会调用 `scripts/workflowctl.py`；创建 lane 与生成候选 diff 会调用 `git`。

## 安装

1. **先构建并打包 provider。** `dsh-codex-app-provider` 这个 devDependency 是指向 `../dsh-codex-app-provider/dsh-codex-app-provider-0.1.1.tgz` 的本地 `file:` tarball 说明（该路径在本仓库之外，这里不做链接）。在 provider checkout 中构建并执行 `npm pack`，使该 tarball 存在。

2. **准备锁定依赖。**

   ```bash
   npm run prepare:local
   ```

   `scripts/prepare-local.mjs` 会检查每个 `file:` devDependency 都以 `.tgz` 结尾且确实存在，执行锁定的 `npm ci --ignore-scripts`，并在 `package.json` 或 `package-lock.json` 被改动时报错。

3. **构建本插件。**

   ```bash
   npm run build
   ```

   该命令生成提示技能（`src/prompts/*.md` → `src/generated/prompts.ts`），类型检查并输出 Host（`tsc -p tsconfig.json`），输出客户端类型声明（`tsc -p tsconfig.client.json`），并用 esbuild 打包客户端到 `lib/client.js`。

4. **在 Cordis profile 中把本插件排在 provider 之后**，并配置一条 workflow 条目：

   ```yaml
   - id: dsh-workflow-kit
     name: dsh-workflow-kit
     config:
       stateDir: /absolute/isolated/state/workflow
       workflowSkillDir: /absolute/skills/codex-workflow
       implementationStandardDir: /absolute/skills/audit-implementation-simplicity
       defaultProfile: gpt-workflow
   ```

   本包自带的 bundle patch（`dsh.bundle.patch` → `cordis.patch.yml`）会插入 `dsh-workflow-kit` 条目（`id` 与 `name`），因此 profile 只需提供 `config`。

配置字段（`src/host.ts:36`）：

| 字段 | 含义 |
| --- | --- |
| `stateDir` | 绝对持久化根目录，其中保存 `orchestration.json`（run、lane、Session 的 profile/策略选择、native child 绑定）。省略时使用启动 profile 自身的状态目录：`<profile home>/state/<profile name>/workflow`。没有启动 profile 时退回 `$DSH_HOME/state/default/workflow`，再退回 `~/.dsh/state/default/workflow`。非绝对路径会被拒绝。 |
| `workflowSkillDir` | 已安装的 `codex-workflow` 技能目录。各角色的协议文档读取自 `<workflowSkillDir>/references/roles/<protocol>`。 |
| `implementationStandardDir` | 已安装的实现标准目录，读取 `<implementationStandardDir>/SKILL.md`。省略时默认使用 `workflowSkillDir` 旁的 `audit-implementation-simplicity` 技能。 |
| `defaultProfile` | 新 Session 采纳配置时的部署兜底值。已存储的 `defaultConfig` 选择优先于它。 |

其余四个入口字段 `defaultConfig`、`codingStrategy`、`integrateStrategy` 与 `configs` 是 volatile 设置，由本插件自己的配置表单实时编辑，无需重新挂载插件（`src/settings.ts:28`、`src/host.ts:70`）。

## 配置与 Profile

两个目录被有意分开：

| 目录 | 成员 | 用途 |
| --- | --- | --- |
| **执行角色目录** | `planner`、`reviewer`、`context_collector`、`coding_worker`、`evidence_runner`、`full_tester` | 契约中 `Role` 允许填写的值，也是派发工具能启动的角色。 |
| **配置键目录** | `planner`、`reviewer`、`context_collector`、`def_coding_worker`、`sup_coding_worker`、`evidence_runner`、`full_tester` | Profile、已存储覆盖项和设置页面编辑的键。 |

`def_coding_worker` 与 `sup_coding_worker` 是同一个 `coding_worker` 执行角色的两套模型配置——它们不是角色，也不是权限等级。这两个键保持稳定，因此既有 Profile 文件与已存储覆盖项无需迁移（`src/roles.ts:33`）。把它们当作角色填写的旧契约或旧委派会在启动前被拒绝：

- 派发时：`Legacy coding role <name> must be revised to Role: coding_worker before dispatch; the bound strategy selects the sup/def configuration`（`src/workflow.ts:253`）；
- 委派时：同样的拒绝，措辞为 `before delegation`（`src/workflow.ts:269`）。

已创建的子会话保留其创建时记录的配置。

**三层键解析。** 每个配置键按顺序解析：**已存储的用户覆盖项** → **随包发布的配置** → **随包发布的键默认值**（`src/configuration.ts:147`）。已存储覆盖是稀疏的，因此修改一个键不会影响其他键的继承；清除某个配置的已存储小节会整体回退。id 与随包配置相同的已存储配置会覆盖它；其他任何 id 都是用户自建配置。

随包发布的 Profile（属于包内容，不是用户配置）：

| Profile | provider | 角色 |
| --- | --- | --- |
| `gpt-workflow`（`profiles/gpt-workflow.json`） | `codex` | `planner` = `gpt-6-astra`（high）；`reviewer` = `gpt-6.1-sol`（high）；`context_collector` = `gpt-6-luna`（high）；`def_coding_worker` = `gpt-6-luna`（medium）；`sup_coding_worker` = `gpt-6.1-sol`（medium）；`evidence_runner` = `gpt-6-luna`（medium）；`full_tester` = `gpt-6-luna`（medium）。 |
| `ds-workflow`（`profiles/ds-workflow.json`） | `deepseek-official` | 每个键都是 `deepseek-flash`，其中 `planner`、`reviewer`、`context_collector` 为 `max` effort，coding、evidence 与 tester 键为 `high`。 |

这些随包键默认值也是未知或缺失配置的兜底值（`src/roles.ts:44`）。旧的 `gpt-6-sol` 已不再是任何随包默认值；仍需要它的部署必须在自己 Profile 或已存储覆盖项中显式声明。

**设置页面与输入框选择器。** Workflow 设置页面（`settings.section`，id 为 `workflow`）以路径变更的方式编辑已存储层：逐键的 provider/model/effort 编辑器，以及复制、重命名、删除、重置、设为默认等操作。随包配置可通过稀疏覆盖就地编辑并整体重置；副本是普通用户配置，可重命名或删除。`manager` 行会列出但不可编辑——manager 运行在输入框所选的模型上。输入框选择器（`conversation.input.left`，id 为 `workflow-config`）只做**选择**：选择配置和该 Session 的 coding 策略；它每次打开都会重新读取目录，并且在 subagent Session 中两个 chip 都会隐藏，因为该子会话的 profile 与策略已由启动它的委派固定。

## 策略

策略不是权限等级。它决定一次 coding 执行使用哪套 Profile 模型配置、是否允许交接或请求有界专家咨询，以及 Host 绑定哪段阶段提示。执行角色自始至终都是 `coding_worker`。

可选策略有四种：`economy`、`adaptive`、`bootstrap`、`expert`（`src/constants.ts:27`）。已存储的 coding 默认值是 `adaptive`，integrate 默认值是 `economy`。两者写入不同的设置路径，任何一方都不会覆盖另一方。coding 可由输入框做 per-Session 覆盖；integration 没有 Session 作用域，始终使用已存储的 integrate 设置（`src/store.ts:48`、`src/profile-rpc.ts:108`）。

| 请求的策略 | 阶段 | 模型配置 | 交接 | 咨询 | 绑定的阶段提示 |
| --- | --- | --- | --- | --- | --- |
| `economy` | main | `def_coding_worker` | 否 | 否 | `coding-independent` |
| `expert` | main | `sup_coding_worker` | 否 | 否 | `coding-independent` |
| `adaptive` | main | `def_coding_worker` | 否 | 是 | `coding-adaptive` |
| `bootstrap` | opening | `sup_coding_worker` | 是 | 否 | `coding-bootstrap-opening` |
| `bootstrap` | continuation | `def_coding_worker` | 否 | 是 | `coding-bootstrap-continuation`、`coding-adaptive` |
| 任意 | consultation | `sup_coding_worker` | 否 | 否 | `coding-consultation` |

（来源：`bindCodingStrategy`，`src/strategy.ts:69`）

**派生的 `independent`。** 当 Profile 的 `sup_coding_worker` 与 `def_coding_worker` 解析为同一 provider 与模型时，两种可选策略都不起作用：有效策略为 `independent`，def 独立完成整个任务，不授权交接或咨询，输入框也隐藏策略控件。该比较有意忽略 effort；已存储的偏好会被保留，切换到模型不同的 Profile 后重新生效（`src/strategy.ts:31`、`src/client/ConfigPicker.tsx:122`）。这是由配置推导出的行为，不是第五种可选策略。

**绑定。** 每次 coding 派发与每次集成都会记录其有效策略以及绑定时捕获的 sup/def Profile 快照，因此之后修改 Profile 或设置不会改写正在运行的执行或已准备的集成；refresh 后的集成绑定的是准备它时生效的设置（`src/configuration.ts:199`）。集成评审与修复保留各自的角色与权限——reviewer 只读，修复用的 `coding_worker` 保留其写入范围——integrate 策略只负责选择模型配置（`src/workflow.ts:400`）。

**委派是例外。** 普通 `delegate` 子会话没有 attempt，也没有 generation，Host 无法为它推进交接或投递咨询报告：被委派的 coding 子会话始终独立运行 def 配置，与 Session 的 coding 策略无关（`src/workflow.ts:270`）。

## Session 门禁与写权限

Host 启动的每个子会话在启动前都被绑定到 `{ role, hook, args }`，该绑定随其记录一起存储（`src/gate.ts:198`）。`role` 是本插件自己的业务标签；provider 从不枚举或解释它。所有规则集中在同一个确定性函数 `workflowGateHandler` 中，两个入口都不调用模型（`src/gate.ts:359`）：

- **DSH 原生路径。** 一个全局 `ctx.tools.guard()` 只对 Host 已注册的 Session 作答——受管子会话的已存储绑定，或由其所采纳 run 推导出的 manager 绑定——因此拒绝发生在工具主体执行之前（`src/host.ts:106`、`src/host.ts:168`）。
- **Codex 路径。** 同一个函数以 `workflow.preToolUse` hook 注册到 provider 的 `codexToolGate` 能力上；provider 会把每次 PreToolUse 调用转发给它（`src/host.ts:165`、`src/gate.ts:21`）。

会被拒绝的内容：

- **manager** 被拒绝已知 shell 入口（`bash`、`pwsh`、`Bash`、`exec_command`、`shell`、`shell_command`、`write_stdin`），并且只能写入本 generation 的 `summary.md`，以及 assignment 显式授予的辅助路径。已注册的子会话可以运行 shell：门禁不读取程序的文件副作用，既有 sandbox 仍然生效。
- 每个已注册 Session 都被拒绝调度类入口：`subagent`、`subagent_fork`、`workflow`、`ralph`、`spawn_teammate`、`wait_agent`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`、`send_message`、`interrupt_agent`、`codex_workers`，以及 Codex 的 `spawn_agent`、`Agent`、`resume_agent`、`close_agent`。只读查询（`list_agents`、`list_subagent_models`、`job_*`）仍然可用。
- 已知的文件写入会与 assignment 自身的授权比对（`write`/`edit` 读 `file_path`；`str_replace_editor` 读 `path`，其中 `view` 是读取，只有 `create`/`str_replace`/`insert` 会写入；Codex `apply_patch` 会检查每条 Add/Update/Delete/Move 指令，任一未授权路径都会拒绝整个 patch）。coding assignment 逐条拥有其任务的 `Owned paths`——绝不是整个 lane——外加声明的 `Write` 路径、具体的报告路径与其 artifacts。评审、咨询、集成修复以及非 coding 任务只拥有被分配的内容。路径同时按字面形式与 symlink 解析后的形式检查，且产品授权额外限制在 lane 内。
- 当 Session cwd 缺失时，文件写入会被拒绝，而不是按服务器启动目录解析。相对路径按操作自身报告的 cwd 解析；该 cwd 不必等于 assignment 的 cwd，因为 assignment 声明的是允许写哪些路径，而不是调用者站在哪里。

以下内容**有意不在覆盖范围内**，也不作声明：shell 程序内部的文件副作用、注册为 `mcp__<server>__<name>` 的 MCP 工具，以及可在运行时注册并执行任意代码的 `cordis_define`/`cordis_run`。未知工具交由流水线中其他检查处理。

拒绝信息始终以 `workflow gate: ` 开头，因此在 session 日志中可被机器识别（`src/gate.ts:31`）。拒绝会同时给出被拒路径与 assignment 实际授权的路径（目录授权带结尾分隔符），因此把相对路径解析到错误目录的 worker 可以自行纠正。没有绑定的 Session——普通委派，或门禁出现之前写入的旧记录——不受影响。

**原生子会话的工作目录差异。** DSH 无法把子会话放到另一个目录：内置 subagent 运行时会把父会话的 workspace 复制进子 Session header，因此 DSH 原生子会话的相对路径按仓库解析。Codex 子会话的线程在分配的目录中启动，相对路径因此落在 lane 内。提示词会说明子会话实际运行的位置，并告知原生子会话把每条命令的工作目录设为分配的目录（传 `workdir`，或先 `cd`）——否则它会把文件写进 lane，却在仓库上跑测试，而门禁无法发现这种失败，因为命令确实成功了，只是作用在错误的目录树上（`src/workflow.ts:299`）。

**lane。** 每次 run 创建的 worktree 都位于 `<repository>/agentwork/.lanes/lane-NN`（名称补零，例如 `lane-01`），因此已完成的目标不会在自己的目录里留下待清理的 worktree，同一仓库中的下一个目标会复用已有的 lane（`src/workflow.ts:40`、`src/workflow.ts:1015`）。Host 会执行 plan 声明的并发与 lane 容量、已分配路径的实时占用，以及任务在未指定 lane 时声明的工作目录（`src/workflow.ts:327`、`src/workflow.ts:998`）。

## 工具与客户端界面

Host 只注册一个面向模型的工具：`codex_workflow`（`src/host.ts:170`）。其 `action` 参数接受：

| Action | 类型 | 用途 |
| --- | --- | --- |
| `roles` | 读 | 列出执行角色目录，包含每个角色的 provider、model、effort 以及是否实现代码。 |
| `status` | 读 | 报告已采纳 generation 的任务、lane、worker 与待处理工作。 |
| `adopt` | 写 | 采纳绝对路径 `<repository>/agentwork/<goal>/generation-N` 目录。 |
| `dispatch` | 写 | 启动任务的 attempt，可选指定 `lane` 与 `base`。 |
| `record-result` | 写 | 记录承载任务结果的保留报告文件（`result`，绝对路径）。 |
| `accept` | 写 | 接受已记录的结果。 |
| `integrate` | 写 | 准备或推进已接受候选的集成。 |
| `resolve` | 写 | 按 reviewer 决定解决集成冲突。 |
| `resolved` | 写 | 记录解决结果。 |
| `refresh-integration` | 写 | 把集成重新绑定到当前生效的设置与快照。 |
| `continue` | 写 | 向任务的 worker 或指定 worker 发送更正。 |
| `archive` | 写 | 在不交付候选的情况下归档已停止的 attempt。 |
| `release` | 写 | 在任务工作结束后释放其 lane 与占用。 |
| `complete` | 检查 | 只做检查：每个可执行任务都必须已交付并释放证据，且不得还有未关闭的 lane 或子会话。它不执行任何 Git 操作，而是以未完成事项拒绝。 |
| `delegate` | 写 | 在不采纳 generation 的前提下把一个有界任务分配给某个角色；传 `role` 与 `text`。带 `child` 时继续或引导已有子会话，带 `stop: true` 时停止当前轮次。 |

该工具还接受 `generation`、`task`、`attempt`、`lane`、`base`、`result`、`text`、`recipient`、`processesStopped`、`role`、`child`、`stop`、`cwd`、`name`、`writes` 与 `network`（`src/host.ts:175`）。`delegate` 会在子会话开始工作前就返回：每个结果都带有子会话句柄与 `reply`，或带原因的 `reply: null`；尚未结束的子会话会通过运行时自身的 settlement 通知在后续轮次出现。`codex_workers` 只跟踪它自己创建的 worker，无法读取这里启动的子会话（`src/host.ts:174`）。

客户端半部分注册：

- 位于 `conversation.input.left` 的**输入框配置选择器**，其 chip 用于选择该 Session 的工作流配置与 coding 策略；
- 位于 `settings.section`（id 为 `workflow`）的 **Workflow 设置页面**，包含保存两项独立策略默认值的 **Strategy** 标签页，以及保存逐键编辑器的 **Configurations** 标签页（`src/client/index.ts:49`、`src/client/index.ts:60`）。

## 兼容性

`package.json` 声明了本构建所校验的 DSH 版本：

```json
"dsh": { "compatibility": { "dshReleases": { "0.1.7-rc.2": "compatible", "0.2.0-rc.2": "compatible" } } }
```

所有 DSH Host 包都是**可选的 `*` peer dependency**（`peerDependencies` 与 `peerDependenciesMeta`），因此一份构建可以加载到列表中的每个版本上；例外是 `dsh-codex-app-provider`——它是被固定为 `0.1.1` 的可选 peer。仓库中检入的 `devDependencies` 固定了用于类型检查与测试的同一代版本（`0.1.7-rc.2`）。

隔离安装会自带 Host 代版本：`scripts/pack-check.mjs` 要求 `@deepseek-ai/dsh-*` 的 devDependency 说明只对应一个代版本，安装 `@deepseek-ai/dsh@<该代版本>` 以及新打包的 provider（workflow 组合还包含本包），并把 `dsh-codex-app-provider` override 到刚打出的 tarball。

## 开发

以下命令均在仓库根目录执行。

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 生成提示技能，编译 Host（`tsconfig.json`），输出客户端声明（`tsconfig.client.json`），并用 esbuild 把客户端打包为 `lib/client.js`。 |
| `npm test` | 运行 `node --test test/*.test.mjs`（26 个测试文件）。测试从编译产物 `lib/*` 导入，因此需先执行 `npm run build`。 |
| `npm run prepare:local` | 检查本地 `file:` tarball 是否存在，执行锁定的 `npm ci`，不修改 manifest。 |
| `npm run pack:check` | 在临时目录中打包本包与 provider，以固定的 Host 代版本安装 provider-only 与 provider+workflow 两种组合，并挂载真实 Cordis 运行时，不调用模型，也不使用浏览器。它会保留临时目录并打印其路径。provider checkout 默认为 `../dsh-codex-app-provider`，可用 `DSH_CODEX_APP_PROVIDER_CHECKOUT` 指定其他位置。 |
| `npm run dev` | 仅 Linux。支持 `--profile <name>`（默认 `workflow-dev`）、`--app-provider <checkout>`（或 `DSH_CODEX_APP_PROVIDER_CHECKOUT`），以及可重复的 `--patch <file>` overlay。要求 profile 依次加载 `dsh-codex-app-provider` 与 `dsh-workflow-kit`、provider 的 `stateDir` 为绝对路径，且 HMR roots 覆盖两个 checkout 的 `lib`。它会构建两个 checkout、启动两个 watcher，然后在端口 0 启动一个 `dsh` Host，或复用同 profile 的存活 Host（基于 `/proc` 的属主检查）。被复用的 Host 在退出时保持运行。 |
| `npm run dev:host` | 启动或检查开发 Host，但不启动长期 watcher。支持 `--profile`（默认 `workflow-kit-dev`）、`--port`（默认 `3080`），`--check` 只做校验。 |
| `npm run publish` | 在暂存目录构建后以一次 rename 替换 `lib/`，因此正在监听的 Host 不会看到写了一半的 bundle。 |
| `npm run publish:watch` | 同上，并在 `src/` 任意变更时重新发布。 |

**watcher 发布行为。** `scripts/watch.mjs`（由 `npm run dev` 使用）在 `.watch/publish-build` 中构建并原子替换 `lib/`。它同时监听 provider 的 `src/`：provider 的任意源码变更都会暂停发布，直到 Host 重启。`npm run publish:watch` 以同样方式发布完整的暂存构建，只由本包的 `src/` 触发。

策略与提示接线的设计记录见 [upgrade.md](upgrade.md) 与 [docs/upgrade-prompts.md](docs/upgrade-prompts.md)。

## 验证面向模型的接口

测试套件覆盖工具背后的行为——规划、委派边界、策略、存储以及 Host 的路由。它无法覆盖工具的**面向模型**的表面：action 集合、参数语义，以及 agent 实际读到的错误措辞。这些问题只在真实对话中才会暴露。

**当工具的 description、parameters、error 文本或 action 集合发生变化时，必须执行本流程。**

传输由脚本驱动，判断不由脚本做出：

1. 用脚本驱动真实对话：

   ```bash
   DSH_TOKEN=<token from the `dsh web:` line> node scripts/dialog-check.mjs "<prompt>"
   ```

   `scripts/dialog-check.mjs` 会向运行中的 `dsh web` origin 认证，新建一个 Session，发送一条普通用户 prompt，等待该轮结束，并打印驱动 Session 的 transcript 以及本次运行创建的任何 Session。它不做任何断言。`DSH_BASE`、`DSH_CWD`、`DSH_HOME`、`DSH_TIMEOUT_MS` 可覆盖其默认值。
2. 使用不含参数提示的用户级目标，这样测的是 agent 仅凭工具描述能推断出什么。
3. 阅读打印出的 transcript，判断 **reply**，而不是判断调用是否返回。

委派路径的检查清单：

1. 用 `codex_workflow { action: "delegate", role: "evidence_runner", text: "<a greeting>" }` 启动子会话。`evidence_runner` 不修改源码，因此这次检查成本很低。结果必须带 `reply: null` 并说明 reply 将在何处到达；只返回裸句柄就是该字段要取代的缺陷。
2. 确认**只有一个**通知结束该子会话，且它来自运行时自身——workflow 插件不贡献任何通知。该通知给出子会话名称并携带其结束消息，或说明它没有留下消息。
3. 确认调用方既不轮询、不 sleep，也不为等待 reply 再花一次调用：它结束自己的轮次，由该通知把 reply 带入下一轮。用 `{ action: "delegate", child: "<handle>" }` 重新读取已结束的子会话，仍会从持久报告中返回 `reply`。
4. 用返回的句柄向**同一个**子会话发送第二轮——`{ action: "delegate", child: "<handle>", text: "<a follow-up>" }`——确认 reply 延续该对话，而不是新开一个。
5. 确认调用方不会拿该句柄去调用 `codex_workers`：它只跟踪自己的 worker，其 `get` 会拒绝，`reports` 返回空列表。
6. 用 `{ action: "delegate", child: "<handle>", stop: true }` 停止当前轮次，确认返回的子会话状态发生变化。
7. 确认以上步骤都不需要 `adopt` 或 `generation`：委派是不依赖 generation 的路径。

诸如在需要 `text` 的地方读了 `task`，或错误信息没有指出应传哪个字段之类的缺陷，只有在 transcript 中才可见。

## 当前验证状态

- `npm test` 运行 26 个测试文件，覆盖配置合并、角色解析、策略、门禁、委派、派发、交接、存储、profile RPC、客户端 bundle 以及 dev/pack 脚本。它们使用编译后的 Host、进程内的假 provider 与打桩的 Host 服务，不调用模型。
- `npm run pack:check` 对 provider-only 与 provider+workflow 两种组合执行隔离的 Node/Cordis 安装检查，其通过行会打印 `no model or browser`。
- 真实模型验证——实盘派发、跨 provider 后继续接与浏览器检查——不在已提交的自动化套件中。策略设计记录 [upgrade.md](upgrade.md) 明确说明其目标行为不代表验证结果。
- 本仓库不包含 `evidence/` 目录；此前关于 `evidence/*.json` 记录的说法在本仓库无法核实，因此不再复述。

## 许可证

MIT（见 `package.json` 的 `license`）。

## 相关仓库

- **`dsh-codex-app-provider`** —— 同级的 DSH 插件，提供 Codex 执行引擎、只读的 `codexExecution` 事实以及本插件绑定的 `codexToolGate` 能力。它必须先于 `dsh-workflow-kit` 加载。它被声明为可选 peer dependency，不由本包打包或随包发布，本 README 也不链接到它。
