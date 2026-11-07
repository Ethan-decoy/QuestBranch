import type { Workspace, ResearchNode, Report } from './types'

export const STARTER_WORKSPACE_ID = 'welcome-research'

export function starterResearch(): {
  workspace: Workspace
  nodes: ResearchNode[]
  reports: Report[]
} {
  const createdAt = new Date().toISOString(),
    workspaceId = STARTER_WORKSPACE_ID
  const workspace: Workspace = {
    id: workspaceId,
    name: '探索 AI 原生研究工作台',
    question: '怎样让 AI 研究真正帮助人理清思路？',
    objective: '理解研究画布、上下文与本地体验的取舍，建立可持续深入的研究方式。',
    constraints: '以人的理解与选择为中心；保持轻量；保留报告与来源；不负责外部行动授权。',
    rootId: 'root',
    createdAt,
    updatedAt: createdAt,
  }
  const make = (
    id: string,
    parentId: string | null,
    title: string,
    summary: string,
    color: string,
    openQuestions: string[] = [],
  ): ResearchNode => ({
    id,
    workspaceId,
    parentId,
    title,
    question: title,
    summary,
    color,
    openQuestions,
    relatedIds: [],
    createdAt,
    updatedAt: createdAt,
  })
  const nodes = [
    make(
      'root',
      null,
      'AI 研究如何理清思路？',
      '以研究图串联问题、已有认识与下一步。人选择方向，AI 承接报告继续深入。',
      '#4e806d',
    ),
    make(
      'visual',
      'root',
      '研究画布与思考路径',
      '用研究卡片呈现阶段进展，树状深入，相关研究以引用相连。',
      '#4e806d',
      ['如何让新增分支后的位置保持稳定？'],
    ),
    make(
      'context',
      'root',
      '研究上下文如何连续？',
      '保留根目标，承接当前路径的相关报告；每次研究记录实际使用的材料。',
      '#7186aa',
      ['父研究更新后，如何提醒子研究重新审视？'],
    ),
    make(
      'local',
      'root',
      '跨平台与本地数据',
      '以桌面体验为先，报告和研究关系由本地数据库持久保存。',
      '#b38a5b',
      ['如何设计完整的导出与恢复？'],
    ),
    make(
      'layout',
      'visual',
      '布局怎样保持稳定？',
      '新增方向时，保持当前研究点的视觉位置。',
      '#4e806d',
    ),
    make(
      'progress',
      'visual',
      '如何看懂研究进展？',
      '让人一眼辨认：已知什么，还有哪些问题值得继续。',
      '#4e806d',
    ),
    make(
      'budget',
      'context',
      '怎样选择相关报告？',
      '在有限上下文里保留研究目标与必要依据。',
      '#7186aa',
    ),
    make(
      'restore',
      'local',
      '研究资料如何安全恢复？',
      '验证关闭、重开以及导出后的引用完整性。',
      '#b38a5b',
    ),
  ]
  nodes[0].question = workspace.question
  nodes.find((n) => n.id === 'budget')!.relatedIds = ['visual']
  const report = (
    id: string,
    nodeId: string,
    title: string,
    summary: string,
    findings: string[],
    openQuestions: string[],
    markdown: string,
    sources: Report['sources'],
  ): Report => ({
    id,
    workspaceId,
    nodeId,
    title,
    summary,
    findings,
    openQuestions,
    markdown,
    sources,
    origin: 'import',
    model: '项目设计资料',
    createdAt,
  })
  const reports = [
    report(
      'report-root',
      'root',
      '让研究保持结构与连续性',
      nodes[0].summary,
      [
        '一个节点对应一项研究，报告承载详细内容。',
        '研究结束后，值得继续的问题成为待研究子节点。',
        '用户通过选点与自然语言指令决定研究方向。',
      ],
      ['如何同时保留全局脉络和当前焦点？'],
      `## 研究的起点\n\n复杂问题的研究会不断分叉。问之希望让人看见每一条路径的进展，并能承接之前的认识继续深入。\n\n## 三个基本关系\n\n| 对象 | 作用 |\n| --- | --- |\n| 研究节点 | 对应一个值得探索的问题 |\n| 研究报告 | 保存阶段认识、论述与来源 |\n| 子研究方向 | 表示从当前认识继续生长的问题 |\n\n## 当前认识\n\n图上的阶段摘要帮助恢复思路，完整报告提供深入阅读。已有报告并不代表研究已经结束。人可以继续当前问题、转向另一条路径，也可以带着几份报告开展综合研究。\n\n> 问之负责探索的结构与连续性，结论及行动的最终判断由人或对应外部系统承担。\n\n## 下一步\n\n先研究画布、上下文连续性和本地数据三个方向，逐步验证它们如何支持长期探索。\n\n---\n\n这份起始笔记导入自项目已确认的产品定义，不是模型实时生成的研究结果。`,
      [],
    ),
    report(
      'report-visual',
      'visual',
      '把研究进展放回思考的地图',
      nodes[1].summary,
      [
        '研究节点需要呈现问题、状态与简短的阶段摘要。',
        '选择节点后阅读报告并发出研究指令。',
        '展开收起与稳定视角有助于维持空间记忆。',
      ],
      nodes[1].openQuestions,
      `## 为什么需要一张研究地图\n\n报告擅长保存细节，研究图让人看见问题从哪里来、已经走到哪里，以及还可以往哪里继续。\n\n### 卡片应该表达什么\n\n- **正在研究什么**：清楚、可独立理解的问题。\n- **已经了解到什么**：简短的阶段认识。\n- **还有什么不清楚**：尚待探索的问题。\n\n### 交互取舍\n\n以横向研究树作为主导航。相关分支按需关联，完整报告在侧栏阅读。缩放和节点选择应该帮助聚焦，新增方向不应让整张图突然跳走。\n\n## 技术依据\n\nReact Flow 支持自定义 React 节点以及平移、缩放、选择等交互。自动布局需另外实现，可使用 Dagre 排列主研究树。\n\n- [React Flow 官方介绍](https://reactflow.dev/)\n- [布局方案说明](https://reactflow.dev/learn/layouting/layouting)\n\n## 待继续研究\n\n布局稳定性与节点信息密度，需要在真实界面里逐步验证。\n\n---\n\n导入自项目技术选型资料。`,
      [
        {
          id: 'flow',
          title: 'React Flow 官方介绍',
          url: 'https://reactflow.dev/',
          excerpt: '自定义 React 节点、缩放、平移与选择。',
        },
        {
          id: 'layout',
          title: 'React Flow 布局说明',
          url: 'https://reactflow.dev/learn/layouting/layouting',
          excerpt: '自动布局方案与 Dagre。',
        },
      ],
    ),
    report(
      'report-context',
      'context',
      '让下一次研究承接之前的认识',
      nodes[2].summary,
      [
        '根问题与全局约束应持续保留。',
        '优先使用当前研究路径和明确引用的报告。',
        '报告更新保留历史，研究运行记录采用的具体版本。',
      ],
      nodes[2].openQuestions,
      `## 连续性的关键\n\n继续研究时，模型需要知道当前问题、之前已经形成的认识，以及还没有弄清的部分。\n\n## 本次输入应包括\n\n1. 根问题、研究目标与约束。\n2. 当前节点的问题和人的最新指令。\n3. 祖先路径上的相关研究报告。\n4. 用户明确指定的其他研究成果。\n\n其他分支不会默认混入。长报告可以采用摘要，但需要记录来源与取舍。\n\n## 历史如何保留\n\n每次完成研究都保存新的报告。下游研究保留实际使用的报告引用，父研究的后续修订不会改写过去的生成依据。\n\n## 尚待验证\n\n需要用真实研究比较不同摘要长度的效果，并观察何时应提醒用户上游内容发生变化。\n\n---\n\n导入自项目上下文设计资料。`,
      [],
    ),
  ]
  return { workspace, nodes, reports }
}
