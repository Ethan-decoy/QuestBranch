import { t } from '../i18n'
import type { ReasoningEffort } from '../research/types'
import type { ResearchStatus } from './research-status'

/** Translate UI semantics at render time, keeping stored records and model labels intact. */
export function statusText(status: ResearchStatus): string {
  switch (status.key) {
    case 'pending':
      return t('待研究')
    case 'discussed':
      return t('已开展讨论')
    case 'running':
      return status.label === '讨论中' ? t('讨论中') : t('研究中')
    case 'ready':
      return status.label === '已有研究记录' ? t('已有研究记录') : t('已有认识')
    case 'failed':
      return t('需要重试')
    case 'interrupted':
      return t('已中断')
  }
}

export function effortText(effort: ReasoningEffort): string {
  switch (effort) {
    case 'none':
      return t('关闭')
    case 'minimal':
      return t('最低')
    case 'low':
      return t('低')
    case 'medium':
      return t('中')
    case 'high':
      return t('高')
    case 'xhigh':
      return t('很高')
    case 'max':
      return t('最高')
    case 'ultra':
      return t('旧版档位，请重新选择')
  }
}

/** Only known QB runtime labels are localized; agent output and arbitrary text stay intact. */
export function runtimeLabel(label: string): string {
  switch (label) {
    case '先生成研究报告':
      return t('先生成研究报告')
    case '准备 DSH 研究会话':
      return t('准备 DSH 研究会话')
    case '等待在 DSH 中回应':
      return t('等待在 DSH 中回应')
    case 'DSH 正在研究':
      return t('DSH 正在研究')
    case '准备研究材料':
      return t('准备研究材料')
    case '等待智能体响应':
      return t('等待智能体响应')
    case '等待你的回应':
      return t('等待你的回应')
    case '正在调用工具':
      return t('正在调用工具')
    case '正在回复':
      return t('正在回复')
    case '正在生成报告':
      return t('正在生成报告')
    case '检索相关公开资料':
      return t('检索相关公开资料')
    case '正在回复当前节点的讨论':
      return t('正在回复当前节点的讨论')
    case '模型正在研究与撰写报告':
      return t('模型正在研究与撰写报告')
    case '整理报告与后续研究方向':
      return t('整理报告与后续研究方向')
    case '对话已保存':
      return t('对话已保存')
    case '已停止':
      return t('已停止')
    case '研究未完成':
      return t('研究未完成')
    case '回复未完成':
      return t('回复未完成')
    case '报告未完成':
      return t('报告未完成')
    case '应用关闭，回复中断':
      return t('应用关闭，回复中断')
    case '应用关闭，报告中断':
      return t('应用关闭，报告中断')
    case '读取研究与分支':
      return t('读取研究与分支')
    case '读取研究报告':
      return t('读取研究报告')
    case '创建研究方向':
      return t('创建研究方向')
    case '保存报告与研究方向':
      return t('保存报告与研究方向')
    case '移除研究分支':
      return t('移除研究分支')
    case '恢复研究分支':
      return t('恢复研究分支')
    default:
      return label
  }
}
