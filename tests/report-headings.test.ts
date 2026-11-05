import { describe, expect, it } from 'vitest'
import { reportHeadings } from '../src/ui/report-markdown'

describe('报告目录与 Markdown 正文定位', () => {
  it('跳过围栏代码中的伪标题，保留正文行号用于焦点定位', () => {
    const markdown =
      '# 研究起点\n\n```md\n## 代码样本\n```\n\n## **中文段落**\n~~~\n### 样本\n~~~\n### 后续问题 ###'
    expect(reportHeadings(markdown)).toEqual([
      { line: 1, level: 1, title: '研究起点' },
      { line: 7, level: 2, title: '中文段落' },
      { line: 11, level: 3, title: '后续问题' },
    ])
  })
})
