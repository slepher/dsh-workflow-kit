# Workflow 下一步修改入口

日期：2026-09-12。状态：UI 清退检查通过，等待下一轮实施；本轮仅整理文档。

本轮统一目标保存在相邻 Codex 仓库，避免重复需求版本：

1. [需求：原生 Codex 主会话与 Subagent 副区](../../dsh-codex-kit/docs/target-requirements.md)
2. [问题：最终候选偏差与 Workflow 清退证据](../../dsh-codex-kit/docs/target-gaps.md)
3. [计划：原生接入、主副区和联合验收](../../dsh-codex-kit/docs/target-plan.md)

以上路径适用于两个相邻 checkout；打包独立阅读时应取得同一轮 Codex 文档。旧 HANDOFF 中冲突的完成声明不覆盖本轮目标。

## 当前结论

候选 `7d367dcf45a1f0dce5ecf44ebfbf0e6f91c85950` 的活动 src/lib、manifest/export、构建和 Host patch 无 UI 注册或旧 UI 文件。2026-09-12 本次执行 `node --test test/headless.test.mjs` 通过，退出 0。合法 backend/browser-types、prompt、测试负断言不算残留。无需单独 UI 清理任务或文档。

## 后续责任

- 所有 main/subagent UI 留在 Codex 包；main 进入主区，subagent 恢复副区，W 不参与呈现。
- 配合计划 P0 核对真实父级和调用者身份；不伪造原生 Agent。
- P3 仅在公共接口实际变化时调整 WorkflowWorkers/Host 消费者；否则产品代码不动，做相关回归。
- 保持 roles/skills、attempt/lane/review/integration、报告验收和 release；普通 subagent 不受 W 编排门禁。
- 保持 headless、单 backend、无平行 worker/report store；验证 B+W 和联合安装、相关 HMR。
- 历史 30/31 全套回归和 live 未运行项继续如实记录，不能由本次 headless PASS 覆盖。

本文件不授权产品修改、Host 重启、上游补丁、用户数据迁移或发布。
