import { uiLocale } from '../i18n'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  GitBranch,
  Link2,
  LoaderCircle,
  Pencil,
  Square,
  Sparkles,
  ListChecks,
  CircleHelp,
  CirclePause,
  PanelRightClose,
  PanelRightOpen,
  Copy,
  MessageSquare,
  Focus,
} from 'lucide-react'
import { useApp } from './state'
import {
  Button,
  EmptyState,
  ExternalLink,
  Feedback,
  SignalIcon,
  nodeStatus,
  StatusLabel,
} from './components'
import type { DetailTab, ReaderState, ResearchRun } from '../research/types'
import { Conversation } from './conversation'
import { AgentActivity, ToolActivities } from './agent-activity'
import { useTheme } from './theme'
import { displayBranchColor } from './theme-colors'
import { ReportMarkdown, reportHeadings } from './report-markdown'
import { ComposerModelPicker } from './models/composer-picker'
import { shouldSendMessage, sendShortcutLabel, useShortcuts } from './shortcuts'
import { useTranslation } from 'react-i18next'
import { runtimeLabel } from './i18n-labels'

function RunRecord({ run }: { run: ResearchRun }) {
  const { t } = useTranslation()
  const Container = import.meta.env.DEV ? 'details' : 'article',
    Header = import.meta.env.DEV ? 'summary' : 'div'
  return (
    <Container className="run-record">
      <Header className="run-record-summary">
        <div>
          <span className={`record-icon ${run.status}`}>
            {run.status === 'failed' ? (
              <SignalIcon tone="error" size={18} />
            ) : run.status === 'interrupted' ? (
              <CirclePause size={14} />
            ) : (
              <Sparkles size={14} />
            )}
          </span>
          <div>
            <strong>{run.instruction || t('研究当前问题')}</strong>
            <small>
              {new Date(run.createdAt).toLocaleString(uiLocale(), {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {run.model}
              {run.reasoningEffort ? ` · ${run.reasoningEffort}` : ''}
            </small>
          </div>
        </div>
        <span className={`record-state ${run.status}`}>
          {run.status === 'completed'
            ? t('已完成')
            : run.status === 'running'
              ? run.mode === 'chat'
                ? t('回复中')
                : t('生成报告中')
              : run.status === 'cancelled'
                ? t('已取消')
                : run.status === 'interrupted'
                  ? t('已中断')
                  : t('未完成')}
        </span>
      </Header>
      {run.error &&
        (run.status === 'interrupted' || run.status === 'cancelled' ? (
          <p className="context-limitation">{run.error}</p>
        ) : (
          <Feedback tone="error">{run.error}</Feedback>
        ))}
      <AgentActivity agent={run.agent} live={run.status === 'running'} />
      <ToolActivities activities={run.activities} live={run.status === 'running'} />
      {import.meta.env.DEV && <RunDiagnostics run={run} />}
    </Container>
  )
}
function RunDiagnostics({ run }: { run: ResearchRun }) {
  const { t } = useTranslation()
  const snapshot = useApp((s) => s.snapshot)!,
    changed = run.context.items
      .filter((item) => item.included)
      .filter((item) => {
        const latest = snapshot.reports.filter((r) => r.nodeId === item.nodeId).at(-1)
        return latest && latest.id !== item.reportId
      })
  return (
    <>
      <h4>{t('实际使用的上下文')}</h4>
      <p className="muted small-text">
        {t('约 {{used}} / {{budget}} tokens', {
          used: run.context.estimatedTokens.toLocaleString(uiLocale()),
          budget: run.context.budget.toLocaleString(uiLocale()),
        })}{' '}
        · {run.context.policy}
      </p>
      <ul className="context-items">
        <li>
          <Check size={12} /> {t('根问题、目标与全局约束')}
        </li>
        <li>
          <Check size={12} /> {t('当前问题、研究路径与本次指令')}
        </li>
        {run.context.items.map((item) => (
          <li key={item.reportId}>
            <span>{item.included ? <Check size={12} /> : <span>−</span>}</span>
            <div>
              {item.title}
              <small>
                {item.reason} ·{' '}
                {item.included ? (item.excerpted ? t('采用摘要') : t('采用全文')) : t('因预算省略')}
              </small>
              <code>{item.reportId.slice(0, 16)}</code>
            </div>
          </li>
        ))}
      </ul>
      {!!run.context.conversation?.includedMessageIds.length && (
        <p className="context-limitation">
          {t('承接本节点 {{count}} 轮对话；消息原文保存在“对话”中。', {
            count: run.context.conversation.includedMessageIds.length / 2,
          })}
        </p>
      )}
      {changed.length > 0 && (
        <Feedback tone="warning">
          <strong>{t('上游报告有更新')}</strong>
          {t('{{count}} 份上游报告已有新版本；本次记录仍保留研究当时采用的版本。', {
            count: changed.length,
          })}
        </Feedback>
      )}
      {run.context.limitations.map((item, i) => (
        <p className="context-limitation" key={i}>
          {item}
        </p>
      ))}
      <details className="raw-details">
        <summary>{t('查看实际发送的输入')}</summary>
        <pre>
          {run.session
            ? JSON.stringify(run.session, null, 2)
            : run.context.messages
                .map((message) => `[${message.role}]\n${message.content}`)
                .join('\n\n')}
        </pre>
      </details>
      <details className="raw-details">
        <summary>{t('查看模型原始输出')}</summary>
        <pre>{run.output || t('尚无输出')}</pre>
      </details>
    </>
  )
}
export function ResearchDetails() {
  const { t } = useTranslation()
  const sendShortcut = useShortcuts((state) => state.sendMessage)
  const [selectionBusy, setSelectionBusy] = useState(false)
  const theme = useTheme((state) => state.theme)
  const snapshot = useApp((s) => s.snapshot)!,
    view = useApp((s) => s.view)!,
    setView = useApp((s) => s.setView),
    open = useApp((s) => s.open),
    command = useApp((s) => s.command)
  const node = snapshot.nodes.find((n) => n.id === view.selectedId)!,
    reports = snapshot.reports
      .filter((r) => r.nodeId === node.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    runs = snapshot.runs.filter((r) => r.nodeId === node.id).reverse(),
    running = runs.find((r) => r.status === 'running'),
    status = nodeStatus(node, snapshot)
  const memory = view.readers?.[node.id]
  const [tab, setTab] = useState<DetailTab>(memory?.tab ?? (reports.length ? 'report' : 'chat')),
    [reportId, setReportId] = useState(memory?.reportId ?? reports[0]?.id ?? ''),
    [history, setHistory] = useState(false),
    [overviewOpen, setOverviewOpen] = useState(memory?.overviewOpen ?? false),
    [questionOpen, setQuestionOpen] = useState(memory?.questionOpen ?? false),
    [copied, setCopied] = useState(false)
  const full = useApp((s) => s.readingMode),
    navigationTarget = useApp((s) => s.navigationTarget),
    setFull = useApp((s) => s.setReadingMode),
    rememberReader = useApp((s) => s.rememberReader),
    tabsId = useId()
  const input = useRef<HTMLTextAreaElement>(null),
    reader = useRef<HTMLDivElement>(null),
    readingToggle = useRef<HTMLButtonElement>(null),
    composing = useRef(false),
    compositionConfirmUntil = useRef(0)
  const report = reports.find((r) => r.id === reportId) ?? reports[0],
    draft = view.chatDrafts?.[node.id] ?? view.drafts[node.id] ?? '',
    children = snapshot.nodes.filter((n) => n.parentId === node.id && !n.removedAt)
  const origin = snapshot.reports.find(
    (report) =>
      report.id === node.originReportId &&
      report.nodeId === node.parentId &&
      report.workspaceId === node.workspaceId,
  )
  const originVersion = origin
    ? snapshot.reports
        .filter((report) => report.nodeId === origin.nodeId)
        .findIndex((report) => report.id === origin.id) + 1
    : 0
  const scrollKey = `${tab}:${tab === 'report' || tab === 'sources' ? (report?.id ?? '') : ''}`
  const remember = (patch: Partial<ReaderState>) =>
    rememberReader(node.id, { tab, reportId: report?.id, ...patch })
  const changeTab = (next: DetailTab) => {
    const fromPanel = document.activeElement?.closest('[role="tabpanel"]')
    setTab(next)
    setHistory(false)
    remember({ tab: next })
    if (fromPanel)
      requestAnimationFrame(() => document.getElementById(`${tabsId}-tab-${next}`)?.focus())
  }
  useLayoutEffect(() => {
    if (reader.current)
      reader.current.scrollTop =
        useApp.getState().view?.readers?.[node.id]?.scroll?.[scrollKey] ?? 0
  }, [scrollKey])
  useEffect(() => {
    if (report) remember({ reportId: report.id })
  }, [report?.id])
  const newestReportId = useRef(reports[0]?.id)
  useEffect(() => {
    const newest = reports[0]
    if (newestReportId.current === newest?.id) return
    newestReportId.current = newest?.id
    // Follow the artifact just saved in this conversation without changing tabs.
    // Opening a node at a historical version must still preserve that selection.
    if (newest?.saveRequest && tab === 'chat') setReportId(newest.id)
  }, [reports[0]?.id])
  useEffect(() => {
    if (navigationTarget?.nodeId !== node.id || navigationTarget.kind === 'node') return
    setTab(navigationTarget.kind === 'source' ? 'sources' : 'report')
    setReportId(navigationTarget.reportId ?? '')
  }, [navigationTarget?.serial])
  useEffect(() => {
    if (
      !navigationTarget ||
      navigationTarget.nodeId !== node.id ||
      navigationTarget.kind === 'node' ||
      navigationTarget.reportId !== report?.id ||
      tab !== (navigationTarget.kind === 'source' ? 'sources' : 'report')
    )
      return
    let highlighted: HTMLElement | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      const container = reader.current
      if (!container) return
      const query = navigationTarget.query.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
      highlighted =
        navigationTarget.kind === 'source'
          ? (container.querySelector<HTMLElement>(
              `[data-source-id="${CSS.escape(navigationTarget.sourceId ?? '')}"]`,
            ) ?? undefined)
          : [
              ...container.querySelectorAll<HTMLElement>(
                '.report-markdown p, .report-markdown li, .report-markdown td, .report-markdown th, .report-markdown h1, .report-markdown h2, .report-markdown h3, .report-markdown pre',
              ),
            ].find((element) =>
              element.textContent?.replace(/\s+/g, ' ').toLocaleLowerCase().includes(query),
            )
      if (highlighted) {
        highlighted.classList.add('material-search-match')
        highlighted.scrollIntoView({ block: 'center' })
        timer = setTimeout(() => highlighted?.classList.remove('material-search-match'), 6000)
      } else container.scrollTop = 0
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      highlighted?.classList.remove('material-search-match')
    }
  }, [navigationTarget?.serial, tab, report?.id])
  useEffect(() => {
    if (full) requestAnimationFrame(() => readingToggle.current?.focus())
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || useApp.getState().dialog || event.isComposing) return
      if (full) {
        event.preventDefault()
        setFull(false)
        requestAnimationFrame(() => readingToggle.current?.focus())
      }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [full])
  const start = async () => {
    if (selectionBusy || running) return
    if (snapshot.settings.backend === 'acp' ? !snapshot.settings.agent : !snapshot.settings.model) {
      open('models')
      return
    }
    try {
      if (!draft.trim()) {
        input.current?.focus()
        return
      }
      await command({ type: 'send-message', nodeId: node.id, message: draft })
      const current = useApp.getState()
      if (current.workspaceId === node.workspaceId && current.view)
        setView({
          chatDrafts: { ...current.view.chatDrafts, [node.id]: '' },
          drafts: { ...current.view.drafts, [node.id]: '' },
        })
      if (current.view?.selectedId === node.id) {
        changeTab('chat')
      }
    } catch {}
  }
  const questionContext = (
    <details
      className="question-context"
      open={questionOpen}
      onToggle={(event) => {
        const enabled = event.currentTarget.open
        if (enabled !== questionOpen) {
          setQuestionOpen(enabled)
          remember({ questionOpen: enabled })
        }
      }}
    >
      <summary>
        <CircleHelp size={13} />
        {t('问题')}
        <ChevronDown size={11} className="disclosure-marker" />
      </summary>
      <p className="full-question">{node.question}</p>
    </details>
  )
  return (
    <aside className={`details-panel ${full ? 'expanded' : ''}`} aria-label={t('研究详情')}>
      <div className="detail-topline">
        <div className="detail-meta">
          <span
            className="tiny-square"
            style={{ background: displayBranchColor(node.color, theme) }}
          />{' '}
          <StatusLabel status={status} />
          <span>
            {node.parentId === null
              ? t('根问题')
              : t('第 {{val}} 层', { val: getDepth(snapshot.nodes, node.id) })}
          </span>
          <span
            className="detail-subtitle"
            title={t('{{length}} 份报告 · {{length2}} 个研究方向', {
              length: reports.length,
              length2: children.length,
            })}
          >
            <FileText size={12} />
            {reports.length}
            <GitBranch size={12} />
            {children.length}
          </span>
        </div>
        <div>
          <button
            className="icon-button"
            title={t('在图谱中定位')}
            aria-label={t('在图谱中定位当前研究')}
            onClick={() => {
              useApp.getState().locate({ kind: 'node', nodeId: node.id, query: '' })
              useApp.getState().showPane('map')
            }}
          >
            <Focus size={16} />
          </button>
          <button
            ref={readingToggle}
            className="icon-button"
            title={full ? t('恢复侧栏') : t('展开阅读')}
            aria-label={full ? t('恢复侧栏') : t('展开阅读')}
            onClick={() => setFull(!full)}
          >
            {full ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <button
            className="icon-button"
            title={t('编辑研究问题')}
            aria-label={t('编辑研究问题')}
            onClick={() => open('edit')}
          >
            <Pencil size={15} />
          </button>
        </div>
      </div>
      <div className="detail-title">
        <h2 title={node.title}>{node.title}</h2>
        {origin ? (
          <button
            className="report-origin"
            title={t('查看来源报告：{{title}} · v{{originVersion}}', {
              title: origin.title,
              originVersion,
            })}
            onClick={() =>
              useApp
                .getState()
                .locate({ kind: 'report', nodeId: origin.nodeId, reportId: origin.id, query: '' })
            }
          >
            <GitBranch size={12} />
            <span>
              {t('来源：{{title}} · v{{originVersion}}', {
                title: origin.title,
                originVersion,
              })}
            </span>
            <ArrowUpRight size={12} />
          </button>
        ) : node.parentId ? (
          <small className="muted">{t('历史分支 · 来源未记录')}</small>
        ) : null}
      </div>
      <div className="detail-tabs" role="tablist" aria-label={t('研究资料')}>
        {(
          [
            ['chat', t('对话'), MessageSquare, null],
            ['report', t('研究报告'), BookOpen, null],
            ['sources', t('来源'), Link2, report?.sources.length ?? 0],
            ['records', t('记录'), Clock3, runs.length],
          ] as const
        ).map(([key, label, Icon, count], index, tabs) => (
          <button
            key={key}
            id={`${tabsId}-tab-${key}`}
            role="tab"
            aria-controls={`${tabsId}-panel-${key}`}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            className={tab === key ? 'active' : ''}
            onClick={() => changeTab(key)}
            onKeyDown={(event) => {
              const target =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : -1
              if (target < 0) return
              event.preventDefault()
              changeTab(tabs[target][0])
              document.getElementById(`${tabsId}-tab-${tabs[target][0]}`)?.focus()
            }}
          >
            <Icon size={14} />
            {label}
            {count !== null && <span>{count}</span>}
          </button>
        ))}
      </div>
      <div
        ref={reader}
        className="detail-body"
        onScroll={(event) => {
          const scrollTop = event.currentTarget.scrollTop,
            saved = useApp.getState().view?.readers?.[node.id]
          if (Math.abs((saved?.scroll?.[scrollKey] ?? 0) - scrollTop) > 1)
            remember({ scroll: { ...saved?.scroll, [scrollKey]: scrollTop } })
        }}
      >
        {tab !== 'report' && questionContext}
        <div
          role="tabpanel"
          id={`${tabsId}-panel-chat`}
          aria-labelledby={`${tabsId}-tab-chat`}
          hidden={tab !== 'chat'}
          tabIndex={0}
        >
          {tab === 'chat' && (
            <Conversation nodeId={node.id} onReadReport={() => changeTab('report')} />
          )}
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-panel-report`}
          aria-labelledby={`${tabsId}-tab-report`}
          hidden={tab !== 'report'}
          tabIndex={0}
        >
          {tab === 'report' && (
            <>
              {running && (
                <div className="research-live">
                  <LoaderCircle size={19} className="spin" />
                  <div>
                    <strong>{runtimeLabel(running.phase)}</strong>
                    {import.meta.env.DEV && (
                      <button onClick={() => changeTab('records')}>
                        {t('查看本次上下文')} <ArrowUpRight size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {running && <AgentActivity agent={running.agent} live />}
              {running && <ToolActivities activities={running.activities} live />}
              {!report ? (
                <>
                  {questionContext}
                  <EmptyState title={t('暂无报告')}>{t('在对话中让 AI 整理研究成果。')}</EmptyState>
                  {node.summary && <div className="notice neutral-notice">{node.summary}</div>}
                </>
              ) : (
                <>
                  <div className="report-version">
                    <span className="origin-tag">
                      {report.origin === 'import' ? t('导入的研究资料') : t('AI 研究报告')}
                    </span>
                    <div className="report-actions">
                      <div className="history-menu">
                        <button
                          onClick={() => setHistory(!history)}
                          aria-label={t('选择报告历史版本')}
                        >
                          <Clock3 size={12} />
                          {report.id === reports[0].id
                            ? t('最新版本')
                            : t('历史版本 {{val}}', {
                                val: reports.length - reports.findIndex((r) => r.id === report.id),
                              })}
                          <ChevronDown size={12} />
                        </button>
                        {history && (
                          <div className="history-popover">
                            {reports.map((r, i) => (
                              <button
                                key={r.id}
                                onClick={() => {
                                  setReportId(r.id)
                                  remember({ reportId: r.id })
                                  setHistory(false)
                                }}
                              >
                                <span>
                                  {i === 0
                                    ? t('最新报告')
                                    : t('历史报告 {{val}}', { val: reports.length - i })}
                                </span>
                                <strong>{r.title}</strong>
                                <small>{new Date(r.createdAt).toLocaleString(uiLocale())}</small>
                                {r.id === report.id && <Check size={13} />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        className="icon-button"
                        title={t('复制报告 Markdown')}
                        aria-label={t('复制报告')}
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
                  </div>
                  <div className="report-controls">
                    {questionContext}
                    <details
                      className="report-overview"
                      open={overviewOpen}
                      onToggle={(event) => {
                        const enabled = event.currentTarget.open
                        if (enabled !== overviewOpen) {
                          setOverviewOpen(enabled)
                          remember({ overviewOpen: enabled })
                        }
                      }}
                    >
                      <summary>
                        <Sparkles size={13} />
                        {t('概览')}
                        <ChevronDown size={11} className="disclosure-marker" />
                      </summary>
                      <section className="insight-box">
                        <div className="section-label">
                          <Sparkles size={14} />
                          {t('阶段认识')}
                        </div>
                        <p>{report.summary}</p>
                      </section>
                      {report.openQuestions.length > 0 && (
                        <section className="open-questions">
                          <div className="section-label">
                            <CircleHelp size={14} />
                            {t('尚待弄清')}
                          </div>
                          <ul>
                            {report.openQuestions.map((q, i) => (
                              <li key={i}>{q}</li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </details>
                    <details className="report-toc">
                      <summary>
                        <ListChecks size={13} />
                        {t('目录', { context: 'report', defaultValue: '目录' })}
                        <span>{reportHeadings(report.markdown).length}</span>
                        <ChevronDown size={11} className="disclosure-marker" />
                      </summary>
                      <nav aria-label={t('报告目录')}>
                        {reportHeadings(report.markdown).map((heading) => (
                          <button
                            key={heading.line}
                            style={{ paddingLeft: `${(heading.level - 1) * 12 + 8}px` }}
                            onClick={() => {
                              const target = reader.current?.querySelector<HTMLElement>(
                                `[data-line="${heading.line}"]`,
                              )
                              target?.scrollIntoView({ block: 'start' })
                              target?.focus({ preventScroll: true })
                            }}
                          >
                            {heading.title}
                          </button>
                        ))}
                      </nav>
                    </details>
                  </div>
                  <article className="markdown report-markdown" tabIndex={-1}>
                    <ReportMarkdown>{report.markdown}</ReportMarkdown>
                  </article>
                  <div className="report-credit">
                    <FileText size={12} />
                    <span>
                      {report.model} · {new Date(report.createdAt).toLocaleDateString(uiLocale())}
                    </span>
                  </div>
                </>
              )}
              {node.relatedIds.length > 0 && (
                <section className="related-research">
                  <div className="section-label">
                    <Link2 size={14} />
                    {t('相关研究')}
                  </div>
                  {node.relatedIds.map((id) => {
                    const related = snapshot.nodes.find((n) => n.id === id)
                    return (
                      related &&
                      !related.removedAt && (
                        <button key={id} onClick={() => useApp.getState().jumpToRelated(id)}>
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
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-panel-sources`}
          aria-labelledby={`${tabsId}-tab-sources`}
          hidden={tab !== 'sources'}
          tabIndex={0}
        >
          {tab === 'sources' && (
            <>
              {report && (
                <div className="source-report">
                  <FileText size={13} />
                  {report.title}
                </div>
              )}
              {report?.sources.length ? (
                report.sources.map((source, i) => (
                  <div className="source-card" key={source.id} data-source-id={source.id}>
                    <span className="source-number">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <ExternalLink href={source.url}>{source.title}</ExternalLink>
                      <small>{safeDomain(source.url)}</small>
                      <p>{source.excerpt}</p>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title={t('暂无外部来源')}>{t('此报告未引用外部资料。')}</EmptyState>
              )}
            </>
          )}
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-panel-records`}
          aria-labelledby={`${tabsId}-tab-records`}
          hidden={tab !== 'records'}
          tabIndex={0}
        >
          {tab === 'records' && (
            <>
              {runs.length
                ? runs.map((run) => <RunRecord run={run} key={run.id} />)
                : !reports.some((r) => r.origin === 'import') && (
                    <EmptyState title={t('暂无研究记录')}>{t('本节点尚未调用模型。')}</EmptyState>
                  )}
              {reports
                .filter((r) => r.origin === 'import')
                .map((r) => (
                  <div className="import-record" key={r.id}>
                    <FileText size={15} />
                    <div>
                      <strong>{t('导入的研究资料')}</strong>
                      <p>{r.title}</p>
                      <small>{new Date(r.createdAt).toLocaleDateString(uiLocale())}</small>
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>
      <div className="research-composer" role="region" aria-label={t('研究输入')}>
        <textarea
          ref={input}
          value={draft}
          onChange={(event) =>
            setView({ chatDrafts: { ...view.chatDrafts, [node.id]: event.target.value } })
          }
          placeholder={t('在这条分支上，你想聊些什么？')}
          aria-label={t('节点对话输入')}
          maxLength={12000}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
            compositionConfirmUntil.current = performance.now() + 50
          }}
          onKeyDown={(event) => {
            if (
              shouldSendMessage(
                event.nativeEvent,
                sendShortcut,
                composing.current || performance.now() < compositionConfirmUntil.current,
              )
            ) {
              event.preventDefault()
              if (!running) void start()
            }
          }}
        />
        <div className="composer-bottom">
          <ComposerModelPicker onBusyChange={setSelectionBusy} />
          {running && (
            <span className="composer-progress" role="status">
              <LoaderCircle className="spin" size={13} />
              <span>{runtimeLabel(running.phase)}</span>
            </span>
          )}
          {running ? (
            <Button
              className="composer-send"
              aria-label={t('停止回复')}
              title={t('停止回复')}
              onClick={() =>
                void command({ type: 'cancel-research', runId: running.id }).catch(() => {})
              }
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="primary"
              className="composer-send"
              aria-label={t('发送消息')}
              aria-keyshortcuts={sendShortcut === 'enter' ? 'Enter' : 'Control+Enter Meta+Enter'}
              title={t('发送消息（{{val}}）', { val: sendShortcutLabel(sendShortcut) })}
              onClick={() => void start()}
              disabled={!draft.trim() || selectionBusy}
            >
              <ArrowUp size={18} aria-hidden="true" />
            </Button>
          )}
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
