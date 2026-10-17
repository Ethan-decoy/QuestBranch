import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  GitBranch,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Square,
  Sparkles,
  ListChecks,
  CircleHelp,
  PanelRightClose,
  PanelRightOpen,
  Copy,
  MessageSquare,
} from 'lucide-react'
import { useApp } from './state'
import { Button, EmptyState, ExternalLink, nodeStatus } from './components'
import type { ResearchRun } from '../research/types'
import { Conversation } from './conversation'

function RunRecord({ run }: { run: ResearchRun }) {
  const snapshot = useApp((s) => s.snapshot)!,
    changed = run.context.items
      .filter((item) => item.included)
      .filter((item) => {
        const latest = snapshot.reports.filter((r) => r.nodeId === item.nodeId).at(-1)
        return latest && latest.id !== item.reportId
      })
  return (
    <details className="run-record">
      <summary>
        <div>
          <span className={`record-icon ${run.status}`}>
            <Sparkles size={14} />
          </span>
          <div>
            <strong>{run.instruction || '研究当前问题'}</strong>
            <small>
              {new Date(run.createdAt).toLocaleString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {run.model}
            </small>
          </div>
        </div>
        <span className={`record-state ${run.status}`}>
          {run.status === 'completed'
            ? '已完成'
            : run.status === 'running'
              ? '研究中'
              : run.status === 'cancelled'
                ? '已取消'
                : run.status === 'interrupted'
                  ? '已中断'
                  : '未完成'}
        </span>
      </summary>
      {run.error && <p className="inline-error">{run.error}</p>}
      <h4>实际使用的上下文</h4>
      <p className="muted small-text">
        约 {run.context.estimatedTokens.toLocaleString()} / {run.context.budget.toLocaleString()}{' '}
        tokens · {run.context.policy}
      </p>
      <ul className="context-items">
        <li>
          <Check size={12} /> 根问题、目标与全局约束
        </li>
        <li>
          <Check size={12} /> 当前问题、研究路径与本次指令
        </li>
        {run.context.items.map((item) => (
          <li key={item.reportId}>
            <span>{item.included ? <Check size={12} /> : <span>−</span>}</span>
            <div>
              {item.title}
              <small>
                {item.reason} ·{' '}
                {item.included ? (item.excerpted ? '采用摘要' : '采用全文') : '因预算省略'}
              </small>
              <code>{item.reportId.slice(0, 16)}</code>
            </div>
          </li>
        ))}
      </ul>
      {!!run.context.conversation?.includedMessageIds.length && (
        <p className="context-limitation">
          承接本节点 {run.context.conversation.includedMessageIds.length / 2}{' '}
          轮对话；消息原文保存在“对话”中。
        </p>
      )}
      {changed.length > 0 && (
        <div className="notice">
          {changed.length} 份上游报告已有新版本；本次记录仍保留研究当时采用的版本。
        </div>
      )}
      {run.context.limitations.map((item, i) => (
        <p className="context-limitation" key={i}>
          {item}
        </p>
      ))}
      <details className="raw-details">
        <summary>查看实际发送的输入</summary>
        <pre>
          {run.context.messages
            .map((message) => `[${message.role}]\n${message.content}`)
            .join('\n\n')}
        </pre>
      </details>
      <details className="raw-details">
        <summary>查看模型原始输出</summary>
        <pre>{run.output || '尚无输出'}</pre>
      </details>
    </details>
  )
}
export function ResearchDetails() {
  const snapshot = useApp((s) => s.snapshot)!,
    view = useApp((s) => s.view)!,
    setView = useApp((s) => s.setView),
    select = useApp((s) => s.select),
    open = useApp((s) => s.open),
    command = useApp((s) => s.command)
  const node = snapshot.nodes.find((n) => n.id === view.selectedId)!,
    reports = snapshot.reports
      .filter((r) => r.nodeId === node.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    runs = snapshot.runs.filter((r) => r.nodeId === node.id).reverse(),
    running = runs.find((r) => r.status === 'running'),
    status = nodeStatus(node, snapshot)
  const [tab, setTab] = useState('report'),
    [reportId, setReportId] = useState(''),
    [history, setHistory] = useState(false),
    [full, setFull] = useState(false),
    [copied, setCopied] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null),
    reader = useRef<HTMLDivElement>(null),
    composing = useRef(false)
  const report = reports.find((r) => r.id === reportId) ?? reports[0],
    draft = (tab === 'chat' ? view.chatDrafts?.[node.id] : view.drafts[node.id]) ?? '',
    children = snapshot.nodes.filter((n) => n.parentId === node.id)
  useEffect(() => {
    setReportId('')
    setTab(snapshot.settings.provider === 'codex' ? 'chat' : 'report')
    setHistory(false)
    if (reader.current) reader.current.scrollTop = 0
  }, [node.id, snapshot.settings.provider])
  const start = async (
    mode: 'chat' | 'research' = tab === 'chat' ? 'chat' : 'research',
    fromConversation = false,
  ) => {
    if (!snapshot.settings.model && snapshot.settings.provider !== 'codex') {
      open('settings')
      return
    }
    try {
      if (mode === 'chat') {
        if (!draft.trim()) {
          input.current?.focus()
          return
        }
        await command({ type: 'send-message', nodeId: node.id, message: draft })
      } else
        await command({
          type: 'start-research',
          nodeId: node.id,
          instruction: fromConversation
            ? '将本节点已进行的讨论与相关研究材料整理成阶段性研究报告。保留已有共识、分歧、依据、待验证主张和后续问题，不把对话意见当作已证实的事实。'
            : draft,
        })
      const current = useApp.getState()
      if (current.workspaceId === node.workspaceId && current.view && !fromConversation)
        setView(
          mode === 'chat'
            ? { chatDrafts: { ...current.view.chatDrafts, [node.id]: '' } }
            : { drafts: { ...current.view.drafts, [node.id]: '' } },
        )
      if (current.view?.selectedId === node.id) {
        if (mode === 'research') setReportId('')
        setTab(mode === 'chat' ? 'chat' : 'report')
      }
    } catch {}
  }
  return (
    <aside className={`details-panel ${full ? 'expanded' : ''}`} aria-label="研究详情">
      <div className="detail-topline">
        <span>
          <span className="tiny-square" style={{ background: node.color }} /> 当前研究
        </span>
        <div>
          <button
            className="icon-button"
            title={full ? '恢复侧栏' : '展开阅读'}
            aria-label={full ? '恢复侧栏' : '展开阅读'}
            onClick={() => setFull(!full)}
          >
            {full ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <button
            className="icon-button"
            title="编辑研究问题"
            aria-label="编辑研究问题"
            onClick={() => open('edit')}
          >
            <Pencil size={15} />
          </button>
        </div>
      </div>
      <div className="detail-title">
        <div className="detail-meta">
          <span className={`status ${status.key}`}>
            <span className="status-dot" />
            {status.label}
          </span>
          <span>
            {node.parentId === null ? '根问题' : `第 ${getDepth(snapshot.nodes, node.id)} 层研究`}
          </span>
        </div>
        <h2>{node.title}</h2>
        {node.question !== node.title && <p className="full-question">{node.question}</p>}
        <div className="detail-subtitle">
          <FileText size={12} />
          {reports.length} 份报告<span>·</span>
          <GitBranch size={12} />
          {children.length} 个研究方向
        </div>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="研究资料">
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'active' : ''}
          onClick={() => setTab('chat')}
        >
          <MessageSquare size={14} />
          对话
        </button>
        <button
          role="tab"
          aria-selected={tab === 'report'}
          className={tab === 'report' ? 'active' : ''}
          onClick={() => setTab('report')}
        >
          <BookOpen size={14} />
          研究报告
        </button>
        <button
          role="tab"
          aria-selected={tab === 'sources'}
          className={tab === 'sources' ? 'active' : ''}
          onClick={() => setTab('sources')}
        >
          <Link2 size={14} />
          来源<span>{report?.sources.length ?? 0}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'records'}
          className={tab === 'records' ? 'active' : ''}
          onClick={() => setTab('records')}
        >
          <Clock3 size={14} />
          记录<span>{runs.length}</span>
        </button>
      </div>
      <div ref={reader} className="detail-body">
        {tab === 'chat' && (
          <Conversation nodeId={node.id} onReport={() => void start('research', true)} />
        )}
        {tab === 'report' && (
          <>
            {running && (
              <div className="research-live">
                <LoaderCircle size={19} className="spin" />
                <div>
                  <strong>{running.phase}</strong>
                  <p>
                    {running.mode === 'chat'
                      ? '本次回复保存在节点对话中；需要报告时可以另行整理。'
                      : running.output
                        ? `已接收 ${running.output.length.toLocaleString()} 字符，完成后生成报告与后续方向。`
                        : '承接已有报告，围绕当前问题继续深入。'}
                  </p>
                  <button onClick={() => setTab('records')}>
                    查看本次上下文 <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
            )}
            {!report ? (
              <>
                <EmptyState title="这条思路，等你继续">
                  从下方输入你想弄清的问题，或直接开始研究。完成后，这里会保存报告和新的研究方向。
                </EmptyState>
                <div className="question-origin">
                  <CircleHelp size={16} />
                  <div>
                    <strong>研究问题</strong>
                    <p>{node.question}</p>
                  </div>
                </div>
                {node.summary && (
                  <div className="notice">
                    {node.summary}
                    <br />
                    这是一条待研究方向，尚未形成研究报告。
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="report-version">
                  <span className="origin-tag">
                    {report.origin === 'import' ? '导入的研究资料' : 'AI 研究报告'}
                  </span>
                  <div className="history-menu">
                    <button onClick={() => setHistory(!history)} aria-label="选择报告历史版本">
                      <Clock3 size={12} />
                      {report.id === reports[0].id
                        ? '最新版本'
                        : `历史版本 ${reports.findIndex((r) => r.id === report.id) + 1}`}
                      <ChevronDown size={12} />
                    </button>
                    {history && (
                      <div className="history-popover">
                        {reports.map((r, i) => (
                          <button
                            key={r.id}
                            onClick={() => {
                              setReportId(r.id)
                              setHistory(false)
                            }}
                          >
                            <span>{i === 0 ? '最新报告' : `历史报告 ${reports.length - i}`}</span>
                            <strong>{r.title}</strong>
                            <small>{new Date(r.createdAt).toLocaleString('zh-CN')}</small>
                            {r.id === report.id && <Check size={13} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <section className="insight-box">
                  <div className="section-label">
                    <Sparkles size={14} />
                    阶段认识
                  </div>
                  <p>{report.summary}</p>
                </section>
                {report.openQuestions.length > 0 && (
                  <section className="open-questions">
                    <div className="section-label">
                      <CircleHelp size={14} />
                      尚待弄清
                    </div>
                    <ul>
                      {report.openQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <div className="report-section-title">
                  <span>完整研究报告</span>
                  <button
                    className="icon-button"
                    title="复制报告 Markdown"
                    aria-label="复制报告"
                    onClick={() => {
                      void navigator.clipboard.writeText(report.markdown).then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      })
                    }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <article className="markdown">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {report.markdown}
                  </Markdown>
                </article>
                <div className="report-credit">
                  <FileText size={12} />
                  <span>
                    {report.model} · {new Date(report.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </>
            )}
            {children.length > 0 && (
              <section className="next-directions">
                <div className="section-label">
                  <GitBranch size={14} />
                  从这里继续 <span>{children.length}</span>
                </div>
                {children.map((child) => (
                  <button key={child.id} onClick={() => select(child.id)}>
                    <span className={`direction-state ${nodeStatus(child, snapshot).key}`} />
                    <span>{child.title}</span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </section>
            )}
            {node.relatedIds.length > 0 && (
              <section className="related-research">
                <div className="section-label">
                  <Link2 size={14} />
                  相关研究
                </div>
                {node.relatedIds.map((id) => {
                  const related = snapshot.nodes.find((n) => n.id === id)
                  return (
                    related && (
                      <button key={id} onClick={() => select(id)}>
                        {related.title}
                        <ArrowUpRight size={14} />
                      </button>
                    )
                  )
                })}
              </section>
            )}
          </>
        )}
        {tab === 'sources' && (
          <>
            <div className="section-intro">
              <h3>报告引用的资料</h3>
              <p>来源属于这份报告。引用与模型的推断需要分别判断。</p>
            </div>
            {report?.sources.length ? (
              report.sources.map((source, i) => (
                <div className="source-card" key={source.id}>
                  <span className="source-number">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <ExternalLink href={source.url}>{source.title}</ExternalLink>
                    <small>{safeDomain(source.url)}</small>
                    <p>{source.excerpt}</p>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="尚无外部来源">
                此研究还没有引用外部资料。配置检索服务后，新的研究可以检索公开资料，并保存实际引用的来源。
              </EmptyState>
            )}
            <div className="notice">
              已有报告中的主张与 AI 的新推断，都不自动等同于经核验的事实。
            </div>
          </>
        )}
        {tab === 'records' && (
          <>
            <div className="section-intro">
              <h3>研究如何走到这里</h3>
              <p>保留原始指令、模型输出与实际使用的报告版本。</p>
            </div>
            {runs.length ? (
              runs.map((run) => <RunRecord run={run} key={run.id} />)
            ) : (
              <EmptyState title="等待第一次研究">
                此节点尚未调用模型。已有研究资料以导入报告保存。
              </EmptyState>
            )}
            {reports
              .filter((r) => r.origin === 'import')
              .map((r) => (
                <div className="import-record" key={r.id}>
                  <FileText size={15} />
                  <div>
                    <strong>导入的研究资料</strong>
                    <p>{r.title}</p>
                    <small>{new Date(r.createdAt).toLocaleDateString('zh-CN')}</small>
                  </div>
                </div>
              ))}
          </>
        )}
      </div>
      <div className="research-composer">
        <div className="composer-target">
          <Sparkles size={13} />
          <span>
            {tab === 'chat'
              ? '围绕当前节点，继续对话'
              : report
                ? '承接这条思路，继续研究'
                : '围绕当前问题，开始研究'}
          </span>
          <button
            className="composer-model"
            title="模型与连接设置"
            onClick={() => open('settings')}
          >
            {snapshot.settings.provider === 'codex'
              ? 'Codex · ChatGPT'
              : snapshot.settings.model || '选择模型'}
          </button>
        </div>
        <textarea
          ref={input}
          value={draft}
          onChange={(event) =>
            setView(
              tab === 'chat'
                ? { chatDrafts: { ...view.chatDrafts, [node.id]: event.target.value } }
                : { drafts: { ...view.drafts, [node.id]: event.target.value } },
            )
          }
          placeholder={
            tab === 'chat'
              ? '在这条分支上，你想聊些什么？'
              : report
                ? '你还想弄清什么？'
                : '补充你关心的角度，或直接开始研究…'
          }
          aria-label={tab === 'chat' ? '节点对话输入' : '研究指令'}
          maxLength={12000}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.ctrlKey || event.metaKey) &&
              !composing.current &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault()
              if (!running) void start()
            }
          }}
        />
        <div className="composer-bottom">
          <button className="text-button" onClick={() => open('node')}>
            <Plus size={14} />
            添加方向
          </button>
          {running ? (
            <Button
              onClick={() =>
                void command({ type: 'cancel-research', runId: running.id }).catch(() => {})
              }
            >
              <Square size={12} />
              {running.mode === 'chat' ? '停止回复' : '停止研究'}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void start()}
              disabled={tab === 'chat' && !draft.trim()}
            >
              <span>{tab === 'chat' ? '发送' : report ? '继续研究' : '开始研究'}</span>
              <Send size={13} />
            </Button>
          )}
        </div>
        <div className="composer-hint">
          <span>
            <span className="save-dot" />
            本地自动保存
          </span>
          <span>Ctrl ↵ 开始</span>
        </div>
      </div>
    </aside>
  )
}
function getDepth(nodes: { id: string; parentId: string | null }[], id: string) {
  let depth = 0,
    current = nodes.find((n) => n.id === id)
  while (current?.parentId) {
    depth++
    current = nodes.find((n) => n.id === current!.parentId)
  }
  return depth
}
function safeDomain(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
