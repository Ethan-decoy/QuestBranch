import type { ResearchRun } from '../research/types'
import type { ResearchStore } from './store'

type RunProgress = Pick<ResearchRun, 'output' | 'agent' | 'activities' | 'toolCalls'>

/** Records QB run transitions; model and agent protocols keep their own execution rules. */
export class ResearchRunLifecycle {
  constructor(
    private readonly store: ResearchStore,
    private readonly runId: string,
  ) {}

  update(updates: Partial<ResearchRun>) {
    if (!this.store.isOpen) return
    const current = this.store.run(this.runId)
    if (current.status === 'running') this.store.saveRun({ ...current, ...updates })
  }

  completeChat(output?: string) {
    this.update({
      ...(output === undefined ? {} : { output }),
      status: 'completed',
      phase: '对话已保存',
      finishedAt: new Date().toISOString(),
    })
  }

  preserve(progress: RunProgress) {
    if (!this.store.isOpen) return
    if (!progress.output && !progress.agent && !progress.activities && !progress.toolCalls) return
    const current = this.store.run(this.runId)
    this.store.saveRun({
      ...current,
      output: progress.output || current.output,
      ...(progress.agent ? { agent: progress.agent } : {}),
      ...(progress.activities ? { activities: progress.activities } : {}),
      ...(progress.toolCalls ? { toolCalls: progress.toolCalls } : {}),
    })
  }

  cancel(abort: () => void) {
    const current = this.store.run(this.runId)
    if (current.status !== 'running') return
    abort()
    // Abort handlers may just have saved usage; always read the current record again.
    this.store.saveRun({
      ...this.store.run(this.runId),
      status: 'cancelled',
      phase: '已停止',
      finishedAt: new Date().toISOString(),
    })
  }

  interrupt() {
    const current = this.store.run(this.runId)
    if (current.status !== 'running') return
    this.store.saveRun({
      ...current,
      status: 'interrupted',
      phase: current.mode === 'chat' ? '应用关闭，回复中断' : '应用关闭，报告中断',
      finishedAt: new Date().toISOString(),
    })
  }

  fail(
    error: unknown,
    options: {
      cancelled: boolean
      progress: RunProgress
      secrets: readonly string[]
      agentSessionBindingId?: string
    },
  ) {
    // Shutdown has already recorded interruption; late asynchronous failures cannot reopen storage.
    if (!this.store.isOpen) return
    const current = this.store.run(this.runId)
    if (current.status === 'cancelled' || current.status === 'interrupted') {
      this.preserve(options.progress)
    } else if (current.status === 'running') {
      let message = error instanceof Error ? error.message : '研究未能完成'
      for (const secret of options.secrets)
        if (secret) message = message.replaceAll(secret, '[密钥已隐藏]')
      this.store.saveRun({
        ...current,
        status: options.cancelled ? 'cancelled' : 'failed',
        output: options.progress.output || current.output,
        ...(options.progress.agent ? { agent: options.progress.agent } : {}),
        error: message,
        ...(options.agentSessionBindingId
          ? { recovery: 'agent-session', agentSessionBindingId: options.agentSessionBindingId }
          : {}),
        phase: options.cancelled ? '已停止' : current.mode === 'chat' ? '回复未完成' : '报告未完成',
        finishedAt: new Date().toISOString(),
      })
    }
  }
}
