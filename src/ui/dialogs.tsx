import { uiLocale } from '../i18n'
import { useDeferredValue, useMemo, useState } from 'react'
import {
  FileText,
  Link2,
  GitBranch,
  LoaderCircle,
  Search,
  Sparkles,
  FolderOpen,
} from 'lucide-react'
import { Modal, Button, Feedback, nodeStatus, StatusLabel } from './components'
import { useApp, flushViewNow } from './state'
import { SettingsDialog } from './settings-dialog'
import { ModelsDialog } from './models/dialog'
import { HostModelsDialog } from './models/host-picker'
import { client } from './client'
import { useTheme } from './theme'
import { displayBranchColor } from './theme-colors'
import { searchResearch, type ResearchSearchHit } from './research-search'
import { branchReport } from '../research/branching'
import {
  comparisonDimensions,
  comparisonInstruction,
  defaultComparisonDimensions,
} from '../research/comparison'
import { useTranslation } from 'react-i18next'
import { ProjectDialog } from './projects/project-dialog'

export function AppDialogs() {
  const dialog = useApp((s) => s.dialog)
  const nodeId = useApp((s) => s.view?.selectedId ?? '')
  if (dialog === 'project') return <ProjectDialog />
  if (dialog === 'workspace' || dialog === 'node' || dialog === 'sibling' || dialog === 'edit')
    return <QuestionDialog kind={dialog} key={dialog} />
  if (dialog === 'settings') return <SettingsDialog />
  if (dialog === 'models') return client.host ? <HostModelsDialog key={nodeId} /> : <ModelsDialog />
  if (dialog === 'search') return <SearchDialog />
  if (dialog === 'compare') return <CompareDialog />
  return null
}
function QuestionDialog({ kind }: { kind: 'workspace' | 'node' | 'sibling' | 'edit' }) {
  const { t } = useTranslation()
  const state = useApp(),
    node = state.snapshot!.nodes.find((n) => n.id === state.view?.selectedId)!,
    [question, setQuestion] = useState(kind === 'edit' ? node.question : ''),
    [name, setName] = useState(''),
    [constraints, setConstraints] = useState(''),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState(''),
    [projectId] = useState(state.projectTargetId)
  const parent =
    kind === 'sibling' ? state.snapshot!.nodes.find((n) => n.id === node.parentId)! : node
  const creating = kind === 'node' || kind === 'sibling'
  const workspace = kind === 'workspace'
  const sourceReports = state.snapshot!.reports.filter(
    (report) => report.nodeId === parent?.id && report.workspaceId === parent.workspaceId,
  )
  const [sourceReportId, setSourceReportId] = useState(
    () => branchReport(state.snapshot!, parent?.id, state.view)?.id ?? '',
  )
  const [requestId] = useState(() => crypto.randomUUID())
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      if (workspace && client.projects) await flushViewNow()
      const result =
        workspace && client.projects
          ? await state
              .projectCommand({
                type: 'create-research',
                projectId,
                question,
                name,
                constraints,
                requestId,
              })
              .then((result) => ({ id: result.workspaceId }))
          : await state.command(
              workspace
                ? { type: 'create-workspace', question, name, constraints }
                : creating
                  ? {
                      type: 'create-node',
                      parentId: parent.id,
                      question,
                      sourceReportId,
                      requestId,
                    }
                  : { type: 'edit-node', nodeId: node.id, question },
            )
      if (workspace) {
        await useApp.getState().refresh()
        if ('id' in result && result.id) await useApp.getState().workspace(result.id)
      } else if (creating) {
        state.select(result.id!, { showDetails: !state.dialogReturnToGraph })
        if (state.dialogReturnToGraph) {
          state.showPane('map')
          setTimeout(
            () =>
              document
                .querySelector<HTMLElement>(
                  `.react-flow__node[data-id="${CSS.escape(result.id!)}"]`,
                )
                ?.focus(),
            100,
          )
        } else {
          // The creation trigger can become disabled on a new, unreported
          // direction. Return keyboard focus to its reader, not the page body.
          setTimeout(
            () =>
              document
                .querySelector<HTMLElement>('.details-panel [role="tab"][aria-selected="true"]')
                ?.focus(),
            100,
          )
        }
      }
      state.open(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Modal
      title={
        workspace
          ? client.projects
            ? t('新建研究')
            : t('新建研究空间')
          : kind === 'sibling'
            ? t('添加同级方向')
            : kind === 'node'
              ? t('添加研究方向')
              : t('编辑研究问题')
      }
      description={kind === 'edit' ? t('保留问题修订和已有报告。') : undefined}
    >
      <form onSubmit={(event) => void submit(event)}>
        {!workspace && (
          <div className="parent-preview">
            <GitBranch size={16} />
            <div>
              <span>{kind === 'edit' ? t('当前研究') : t('从这里展开')}</span>
              <strong>{parent.title}</strong>
            </div>
          </div>
        )}
        {workspace && client.projects && (
          <div className="parent-preview">
            <FolderOpen size={16} />
            <strong>
              {state.snapshot?.projects?.find((project) => project.id === projectId)?.name}
            </strong>
          </div>
        )}
        {workspace && (
          <label className="field">
            {t('研究空间名称')}
            <span>{t('可选')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('例如：探索下一代个人知识工具')}
              maxLength={100}
            />
          </label>
        )}
        {creating && (
          <label className="field">
            {t('来源报告')}
            <select
              aria-label={t('来源报告')}
              value={sourceReportId}
              onChange={(event) => setSourceReportId(event.target.value)}
              disabled={submitting || !sourceReports.length}
            >
              {!sourceReports.length && (
                <option value="">{t('先在当前父节点对话中保存报告')}</option>
              )}
              {sourceReports.map((report, index) => (
                <option key={report.id} value={report.id}>
                  v{index + 1} · {report.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          {workspace ? t('根问题') : t('研究问题')}
          <textarea
            autoFocus
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            placeholder={
              workspace
                ? t('你希望通过这项研究弄清什么？')
                : t('在这个方向上，你还想深入了解什么？')
            }
            required
            maxLength={6000}
          />
        </label>
        {workspace && (
          <label className="field">
            {t('研究约束')}
            <span>{t('可选')}</span>
            <textarea
              rows={2}
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
              placeholder={t('例如：面向个人使用，优先本地方案，关注维护成本')}
              maxLength={6000}
            />
          </label>
        )}
        {error && <Feedback tone="error">{error}</Feedback>}
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={() => state.open(null)}>
            {t('取消')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={submitting || !question.trim() || (creating && !sourceReportId)}
          >
            {submitting ? <LoaderCircle size={14} className="spin" /> : <GitBranch size={14} />}{' '}
            {workspace
              ? client.projects
                ? t('创建研究')
                : t('创建研究空间')
              : creating
                ? t('添加研究方向')
                : t('保存问题')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
function SearchDialog() {
  const { t } = useTranslation()
  const theme = useTheme((state) => state.theme)
  const [query, setQuery] = useState(''),
    snapshot = useApp((s) => s.snapshot)!,
    workspaceId = useApp((s) => s.workspaceId),
    locate = useApp((s) => s.locate),
    open = useApp((s) => s.open)
  const [kind, setKind] = useState<ResearchSearchHit['kind'] | 'all'>('all'),
    deferred = useDeferredValue(query),
    hits = useMemo(
      () => searchResearch(snapshot, workspaceId, deferred, kind),
      [snapshot, workspaceId, deferred, kind],
    )
  return (
    <Modal title={t('搜索研究')}>
      <div className="search-field">
        <Search size={18} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('搜索研究、报告和来源…')}
          aria-label={t('搜索研究与材料')}
        />
      </div>
      <div className="search-filters" role="group" aria-label={t('搜索范围')}>
        {(
          [
            ['all', t('全部')],
            ['node', t('研究')],
            ['report', t('报告')],
            ['source', t('来源')],
          ] as const
        ).map(([value, label]) => (
          <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="search-results">
        {hits.map((hit) => {
          const node = snapshot.nodes.find((node) => node.id === hit.nodeId)!
          return (
            <button
              key={`${hit.kind}:${hit.nodeId}:${hit.reportId ?? ''}:${hit.sourceId ?? ''}`}
              data-search-kind={hit.kind}
              data-report-id={hit.reportId}
              onClick={() => {
                locate(hit)
                open(null)
              }}
            >
              {hit.kind === 'node' ? (
                <span
                  className="tiny-square"
                  style={{ background: displayBranchColor(node.color, theme) }}
                />
              ) : hit.kind === 'report' ? (
                <FileText size={16} />
              ) : (
                <Link2 size={16} />
              )}
              <div>
                <strong>{hit.title}</strong>
                <small className="search-path" title={hit.path}>
                  {hit.label} · {hit.path}
                </small>
                <small>{hit.excerpt}</small>
              </div>
              {hit.kind === 'node' && <StatusLabel status={nodeStatus(node, snapshot)} compact />}
            </button>
          )
        })}
        {!hits.length && (
          <p className="search-empty">{query ? t('没有匹配结果') : t('输入关键词搜索材料')}</p>
        )}
      </div>
    </Modal>
  )
}
function CompareDialog() {
  const { t } = useTranslation()
  const state = useApp(),
    snapshot = state.snapshot!,
    workspace = snapshot.workspaces.find((w) => w.id === state.workspaceId)!,
    nodes = snapshot.nodes.filter((n) => n.workspaceId === workspace.id && !n.removedAt),
    available = snapshot.reports.filter((report) => report.workspaceId === workspace.id),
    latest = nodes
      .map((n) => snapshot.reports.filter((r) => r.nodeId === n.id).at(-1))
      .filter((r) => !!r)
  const [a, setA] = useState(latest[0]?.id ?? ''),
    [b, setB] = useState(latest[1]?.id ?? ''),
    [instruction, setInstruction] = useState(
      t('比较这两个方向的一致、冲突与互补之处，形成新的综合认识，并提出值得继续的问题。'),
    ),
    [dimensions, setDimensions] = useState(defaultComparisonDimensions.join('\n')),
    [created, setCreated] = useState<{ key: string; id: string } | null>(null),
    [working, setWorking] = useState(false),
    [error, setError] = useState('')
  const reports = [available.find((r) => r.id === a), available.find((r) => r.id === b)]
  async function synthesize() {
    if (snapshot.settings.backend === 'acp' ? !snapshot.settings.agent : !snapshot.settings.model) {
      state.open('models')
      return
    }
    if (!reports[0] || !reports[1] || a === b) return
    setWorking(true)
    setError('')
    try {
      const instructionText = comparisonInstruction(
        [reports[0], reports[1]],
        comparisonDimensions(dimensions),
        instruction,
      )
      const key = JSON.stringify([a, b])
      const result =
        created?.key === key
          ? { id: created.id }
          : await state.command({
              type: 'create-node',
              parentId: reports[0].nodeId,
              sourceReportId: reports[0].id,
              referenceReportIds: [a, b],
              question: t('综合研究：{{title}}与{{title2}}', {
                title: reports[0].title,
                title2: reports[1].title,
              }),
              relatedIds: [...new Set([reports[0].nodeId, reports[1].nodeId])],
            })
      setCreated({ key, id: result.id! })
      state.select(result.id!)
      await state.command({
        type: 'start-research',
        nodeId: result.id!,
        instruction: instructionText,
        reportIds: [a, b],
      })
      state.open(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : t('综合研究未启动'))
    } finally {
      setWorking(false)
    }
  }
  return (
    <Modal title={t('分支比较')} wide>
      {latest.length < 2 ? (
        <div className="notice neutral-notice">
          {t('至少需要两个节点分别保存报告，才能进行分支比较。')}
        </div>
      ) : (
        <>
          <div className="comparison-columns">
            {reports.map((report, i) => (
              <div className="compare-column" key={i}>
                <label className="field">
                  {i === 0 ? t('研究方向 A') : t('研究方向 B')}
                  <select
                    aria-label={i === 0 ? t('研究方向 A') : t('研究方向 B')}
                    value={i === 0 ? a : b}
                    disabled={working}
                    onChange={(event) => (i === 0 ? setA : setB)(event.target.value)}
                  >
                    {nodes
                      .filter((node) => available.some((report) => report.nodeId === node.id))
                      .map((node) => (
                        <optgroup key={node.id} label={node.title}>
                          {available
                            .filter((report) => report.nodeId === node.id)
                            .map((report, version, versions) => (
                              // i18next-instrument-ignore: report title and version metadata
                              <option key={report.id} value={report.id}>
                                {node.title}
                                {' · v'}
                                {version + 1}
                                {version === versions.length - 1 ? t('（最新）') : ''} ·{' '}
                                {new Date(report.createdAt).toLocaleDateString(uiLocale())}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                  </select>
                </label>
                {report && (
                  <>
                    <small className="compare-version">
                      v
                      {available
                        .filter((item) => item.nodeId === report.nodeId)
                        .findIndex((item) => item.id === report.id) + 1}{' '}
                      · {new Date(report.createdAt).toLocaleString(uiLocale())} ·{' '}
                      {t('{{length}} 份来源', { length: report.sources.length })}
                    </small>
                    <h3>{report.title}</h3>
                    <p>{report.summary}</p>
                    <div className="section-label">{t('已有认识')}</div>
                    <ul>
                      {report.findings.map((finding, i) => (
                        <li key={i}>{finding}</li>
                      ))}
                    </ul>
                    <div className="section-label">{t('尚待弄清')}</div>
                    <ul>
                      {report.openQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="comparison-config">
            <p className="compare-version">
              {t('结果归属：{{title}} / 新综合', {
                title: nodes.find((node) => node.id === reports[0]?.nodeId)?.title ?? '',
              })}
            </p>
            <label className="field">
              {t('共同比较维度')}
              <textarea
                aria-label={t('共同比较维度')}
                rows={4}
                value={dimensions}
                disabled={working}
                onChange={(event) => setDimensions(event.target.value)}
                placeholder={t('每行一个维度')}
                maxLength={2000}
              />
            </label>
            <label className="field">
              {t('补充研究指令')}
              <textarea
                aria-label={t('补充研究指令')}
                rows={4}
                value={instruction}
                disabled={working}
                onChange={(event) => setInstruction(event.target.value)}
                maxLength={8000}
              />
            </label>
          </div>
        </>
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => state.open(null)}>
          {t('关闭')}
        </Button>
        {latest.length >= 2 && (
          <Button
            variant="primary"
            onClick={() => void synthesize()}
            disabled={working || a === b || !dimensions.trim()}
          >
            {working ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{' '}
            {(
              snapshot.settings.backend === 'acp'
                ? snapshot.settings.agent
                : snapshot.settings.model
            )
              ? t('开展综合研究')
              : t('先连接研究模型')}
          </Button>
        )}
      </div>
    </Modal>
  )
}
