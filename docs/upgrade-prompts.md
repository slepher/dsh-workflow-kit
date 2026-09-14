# 升级技能文本与接线位置

依据：[upgrade.md](../upgrade.md)。当前接续设计为“后继 DSH child＋保留原 Codex thread”。
下文保留先前接入记录；它们不代表新方案已实现或经过真实验证。

## 后继接续设计的待同步项

以 upgrade.md 第 5.4、5.7、5.11 节为当前约定。实现者须将现有阶段提示、
`control.ts` 的交接文案、UI 说明及外部 DSH 协议中的“同一 worker／Session”
改为“同一任务的后继 child”：Codex 内保留原 thread，跨 provider 交接指定上下文。
这些文本改动应与 provider 绑定及 workflow 执行者切换一起接入，不能只改文案。

- 后继机制：Host 先预留 `toWorker` 与 `requestId`，经 provider 的 `ctx.codexHandoff`
  绑定原 Codex thread，再用 `startContinuable` 创建兄弟 child，并从原生事实确认交接完成；
  旧 route-update core 改动不再被本插件引用，其源码记录不要求本轮自动删除。
- `coding-bootstrap-opening`：由 Host 创建后继并交接原 thread，worker 不自行创建 child。
- `coding-bootstrap-continuation`：说明后继身份、当前阶段及真实上下文来源；Codex 内
  指向恢复的原 thread，跨 provider 指向输入的历史和事实，不承诺完整原生历史。
- `integrate-execution` 和外部 `references/operations/dsh.md`：保留 reviewer／coding_worker
  角色边界，允许执行 child 更换，前后报告与释放由 workflow 关联。
- 咨询仍由原请求者接收结果，无需为咨询另建后继主 child。

## 提示组成

设置 → 工作流新增“策略”tab，分别保存 Coding 与 Integrate 默认策略。
Coding 默认 `adaptive`，Session 输入面板的明确选择覆盖此默认值；未选择则继承默认。
Integrate 默认 `economy`（def 独立执行），没有 Session 覆盖，直接使用面板配置。
两者共用四种策略选项、独立保存；集成审核及必要修复使用 integrate 绑定，不能继承
产生候选的 coding 策略。已开始的执行及集成沿用各自快照。

通用长期责任使用 `worker-execution`、`role-coding-worker` 和原有
`implementation-simplicity`。模型配置仍取 Profile 的 sup／def 设置键；
不能把阶段提示加入整个线程的永久角色指令。

| 有效策略／阶段 | 本次下发的提示 | 配置 |
| --- | --- | --- |
| `economy` | [coding-independent](../src/prompts/coding-independent.md) | def |
| 同模型派生 `independent` | coding-independent | def，含其 effort |
| `expert` | coding-independent | sup |
| `adaptive` 主执行 | [coding-adaptive](../src/prompts/coding-adaptive.md) | def |
| `bootstrap` 开路 | [coding-bootstrap-opening](../src/prompts/coding-bootstrap-opening.md) | sup |
| `bootstrap` 接续 | [coding-bootstrap-continuation](../src/prompts/coding-bootstrap-continuation.md) ＋ coding-adaptive | def |
| 有界咨询 child | [coding-consultation](../src/prompts/coding-consultation.md)，不附开路／adaptive 提示 | sup |

Host 同时明确本次绑定的有效策略、当前阶段及任务约定；不能要求 worker 从 Profile
名称或最新 Session 选择猜测。咨询 child 的运行权限也须排除主工作区写入，不能只靠措辞。
控制信号的身份取自原生 worker／turn；managed 工作另外绑定合同版本和 task／attempt。

`handoff` 报告的 `Target tier`、`Summary`、`Remaining` 及 `consult` 报告的
具体问题、目标、选择、证据和期望结论用于控制路由，不能送进最终候选验收。
交接不得新建 attempt、释放 lane 或要求中间 commit；咨询返回原 worker 实施验证。
接续提示必须与对应配置切换绑定，确认来源 turn 结束及写入执行停止后再启动。

旧 `role-def-coding-worker`、`role-sup-coding-worker` 文本保留供旧绑定使用。
新角色应指向 `coding-worker.md` 外部协议，不能把旧角色文本直接改名用于历史执行。

程序接入第一部分已完成：`src/roles.ts` 分开执行角色目录（统一 `coding_worker`）与
Profile 配置键目录（保留 `def_coding_worker`／`sup_coding_worker`），`src/strategy.ts`
解析四种策略、同模型派生的 `independent` 与阶段提示，设置 schema 独立保存
`codingStrategy`／`integrateStrategy`，`/workflow` 增加 `select-strategy`，
设置页新增策略 tab，输入面板增加 Coding 策略控件并在同模型配置下隐藏。
coding 派发与 integration 创建各自记录有效策略及 sup／def 快照，`workflowctl.py`
接受 `coding_worker`（并保留旧键读取兼容），Host 在派发时明确拒绝旧 coding 角色。
提示表已按既有构建流程生成。

接续部分现按后继设计接入：控制报告（`handoff`／`consult`）解析与受控交接（Host 侧
`settleControl`／`settleConsults` 预留 `toWorker` 与 `requestId`、经 provider 的
`ctx.codexHandoff` 绑定原 thread、用 `startContinuable` 创建兄弟 child，并从原生事实
确认交接完成）、跨 provider 接续与 sourced 执行事实导入（provider 的只读 `facts` 投影 ＋
交接后按后继自身的 DSH session log 读取完成与报告）、有界咨询闭环、以及只读用量投影
与按 turn 去重的汇总。交接能力按路线分别要求 `threadHandoff` 或 `factImport`：安装的
DSH／provider 包尚未重建时，Host 通过 `handoffSupport` 与 `control.reason` 报告具体
不可用原因，不静默按旧配置执行。旧的活体 route-update core 改动不再被本插件引用。
本轮不要求删除那些源码记录，也不把它们作为新方案的运行先决条件。

新方案的真实模型验证（Codex 内后继复用 thread、Codex → DeepSeek 后继交接）
须在对应 provider／workflow 包接入后，按 upgrade.md 第 9 节执行；
不将旧 route-update 包集作为新方案的先决条件，不将本页源码记录作为运行验证。

## Integrate 接线补充

[integrate-execution](../src/prompts/integrate-execution.md) 是集成工作专用策略提示，
与实际 reviewer 或 coding_worker 的角色责任组合。它从 integration 快照取策略，
不从 Session coding 覆盖值取策略；普通任务审核不附此提示。
集成需要的阶段提示复用四种策略的控制语义，但措辞须针对实际角色：
reviewer 交回判断与未决事实，coding_worker 交回修复与验证事实，不能把
“完成剩余实现”下发成 reviewer 的责任。开路／接续提示仍按阶段下发。
授权的控制报告优先走独立控制路由，最终审核才返回原有 verdict JSON；
审核与修复保留独立身份，机械合并仍由 Host 执行。

## 外部技能协议源码

源码位于相邻仓库 `../../../codex-workflow/skills/codex-workflow/`（相对本页），
部署时由 `workflowSkillDir` 指向已安装的对应版本。本轮更新源码，未安装：

- `references/operations/dsh.md`：DSH 专用策略、准备、连续执行、控制报告、验收和费用口径。
- `references/roles/coding-worker.md`：统一 coding 角色长期责任。
- `SKILL.md`、共享模型规则、worker／planner／reviewer 协议、派发与报告格式：
  路由到 DSH 约定，保留原生 Codex 的既有角色和流程。

接线时须同步部署这些外部文本；仅更新包装提示会继续加载旧协议。
路线尚不支持时应报告具体不可用原因。后继 child 必须经过第 5.11 节的受控绑定；
不能创建一个新的 Codex thread，再宣称已保留原 thread。
