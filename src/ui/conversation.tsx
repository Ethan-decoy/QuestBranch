import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useRef } from 'react'
import { LoaderCircle, MessageSquare, FileText } from 'lucide-react'
import { useApp } from './state'
import { Button } from './components'

export function Conversation({ nodeId, onReport }: { nodeId: string; onReport: () => void }) {
  const snapshot = useApp((state) => state.snapshot)!
  const messages = snapshot.messages.filter((message) => message.nodeId === nodeId)
  const runs = snapshot.runs.filter((run) => run.nodeId === nodeId)
  const running = runs.some((run) => run.status === 'running')
  const root = useRef<HTMLElement>(null),
    follow = useRef(true)
  useEffect(() => {
    follow.current = true
    const container = root.current?.parentElement
    if (!container) return
    const scroll = () => {
      follow.current = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    }
    container.addEventListener('scroll', scroll)
    return () => container.removeEventListener('scroll', scroll)
  }, [nodeId])
  useEffect(() => {
    const container = root.current?.parentElement
    if (container && follow.current) container.scrollTop = container.scrollHeight
  }, [nodeId, messages.length, runs.at(-1)?.output])
  return (
    <section ref={root} className="conversation" aria-label="节点对话">
      <div className="conversation-toolbar">
        <span>本节点的讨论与原文</span>
        <Button
          onClick={onReport}
          disabled={
            running || !runs.some((run) => run.mode === 'chat' && run.status === 'completed')
          }
        >
          <FileText size={13} />
          整理为报告
        </Button>
      </div>
      {!messages.length && (
        <div className="conversation-empty">
          <MessageSquare size={25} strokeWidth={1.4} />
          <h3>从这条思路，开始对话</h3>
          <p>
            结合当前问题与相关报告，讨论你还想弄清的部分。形成阶段认识后，可以整理成一份新报告。
          </p>
          <small>对话保存在当前节点，切换分支后仍可回来继续。</small>
        </div>
      )}
      {messages.map((message) => {
        const run = runs.find((run) => run.id === message.runId)
        const assistant = message.role === 'assistant'
        const content = assistant && run?.status === 'running' ? run.output : message.content
        return (
          <article className={`chat-message ${message.role}`} key={message.id}>
            <div className="chat-message-meta">
              <strong>{assistant ? (run?.provider === 'codex' ? 'Codex' : 'AI') : '你'}</strong>
              <span>
                {assistant
                  ? run?.model
                  : new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
              </span>
            </div>
            {content && (
              <div className="chat-message-content markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                    img: () => null,
                  }}
                >
                  {content}
                </Markdown>
              </div>
            )}
            {assistant && run?.status === 'running' && (
              <div className="chat-progress" role="status">
                <LoaderCircle className="spin" size={13} />
                {run.phase}
              </div>
            )}
            {assistant && run?.error && <p className="inline-error">{run.error}</p>}
            {assistant && (run?.status === 'cancelled' || run?.status === 'interrupted') && (
              <small className="chat-interrupted">
                {run.status === 'cancelled'
                  ? '这次回复已停止，已有内容保留。'
                  : '应用关闭时回复中断，已有内容保留。'}
              </small>
            )}
          </article>
        )
      })}
      {messages.length > 0 && (
        <p className="conversation-footnote">
          对话中的分析与主张需要判断；生成报告会保留新的版本。
        </p>
      )}
    </section>
  )
}
