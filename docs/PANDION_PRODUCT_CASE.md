# Pandion Health AI Product Case

## Project provenance

- Developed during a school-company internship collaboration with Pandion Health.
- Requirements were based on real operational discussions and iterated through
  weekly meetings with company stakeholders.
- No real patient data was authorised or used.
- All patient-level records in the prototype are synthetic and contain no PHI.
- The current deliverable is a functional prototype, not a production deployment.

## Resume-safe description

“基于校企合作实习中与 Pandion Health 负责人的每周需求沟通，设计并迭代医疗
运营 Dashboard 与 RAG 决策支持原型；在未获患者数据授权的前提下构建 200 条
合成反馈数据，完成结构化筛选、全量主题统计、代表性证据引用及 SOP-grounded
运营建议生成。”

## Product decision demonstrated

Patient Feedback 主题频率不由 LLM 从 Top-K 文本中猜测。系统先对筛选范围内的
全部反馈进行确定性计数，再由 RAG 检索代表性原文和 SOP，最后由 LLM 负责解释
和组织语言。这将“统计事实”和“生成式解释”拆开，降低误导运营决策的风险。

## Evaluation result

建立 20 道人工标注 Golden Set，对 Dense、BM25 与 Hybrid Retrieval 进行同题
对比，并定位“先融合、后路由”造成的召回损失。将场景路由移动至 RRF 前后，
Hybrid Hit Rate@5 从 95% 提升至 100%，MRR@5 从 0.850 提升至 0.896；同时记录
约 78ms 本机平均延迟，并明确该结果不代表
生产环境 SLA。
