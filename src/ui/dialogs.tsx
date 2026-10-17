import { useState } from 'react'
import {
  Check,
  ChevronRight,
  CircleHelp,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  PlugZap,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { Modal, Button, nodeStatus } from './components'
import { flushViewNow, useApp } from './state'
import { client } from './client'
import type { SettingsInput, ConnectionResult } from '../research/types'

export function AppDialogs() {
  const dialog = useApp((s) => s.dialog)
  if (dialog === 'workspace' || dialog === 'node' || dialog === 'edit')
    return <QuestionDialog kind={dialog} key={dialog} />
  if (dialog === 'settings') return <SettingsDialog />
  if (dialog === 'search') return <SearchDialog />
  if (dialog === 'compare') return <CompareDialog />
  return null
}
function QuestionDialog({ kind }: { kind: 'workspace' | 'node' | 'edit' }) {
  const state = useApp(),
    node = state.snapshot!.nodes.find((n) => n.id === state.view!.selectedId)!,
    [question, setQuestion] = useState(kind === 'edit' ? node.question : ''),
    [name, setName] = useState(''),
    [constraints, setConstraints] = useState(''),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState('')
  const workspace = kind === 'workspace'
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = await state.command(
        workspace
          ? { type: 'create-workspace', question, name, constraints }
          : kind === 'node'
            ? { type: 'create-node', parentId: node.id, question }
            : { type: 'edit-node', nodeId: node.id, question },
      )
      if (workspace) state.workspace(result.id!)
      else if (kind === 'node') state.select(result.id!)
      state.open(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Modal
      title={
        workspace ? '从一个问题开始' : kind === 'node' ? '展开一个新的研究方向' : '调整研究问题'
      }
      description={
        workspace
          ? '先明确你想弄清什么，研究会从这里逐渐生长。'
          : kind === 'node'
            ? '新方向会作为当前研究的子节点保存。'
            : '修改会保存历史；已有报告保留原来的内容与来源。'
      }
    >
      <form onSubmit={(event) => void submit(event)}>
        {!workspace && (
          <div className="parent-preview">
            <GitBranch size={16} />
            <div>
              <span>{kind === 'edit' ? '当前研究' : '从这里展开'}</span>
              <strong>{node.title}</strong>
            </div>
          </div>
        )}
        {workspace && (
          <label className="field">
            研究空间名称 <span>可选</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：探索下一代个人知识工具"
              maxLength={100}
            />
          </label>
        )}
        <label className="field">
          {workspace ? '根问题' : '研究问题'}
          <textarea
            autoFocus
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            placeholder={
              workspace ? '你希望通过这项研究弄清什么？' : '在这个方向上，你还想深入了解什么？'
            }
            required
            maxLength={6000}
          />
        </label>
        {workspace && (
          <label className="field">
            研究约束 <span>可选</span>
            <textarea
              rows={2}
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
              placeholder="例如：面向个人使用，优先本地方案，关注维护成本"
              maxLength={6000}
            />
          </label>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={() => state.open(null)}>
            取消
          </Button>
          <Button variant="primary" type="submit" disabled={submitting || !question.trim()}>
            {submitting ? <LoaderCircle size={14} className="spin" /> : <GitBranch size={14} />}{' '}
            {workspace ? '创建研究空间' : kind === 'node' ? '添加研究方向' : '保存问题'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
function SettingsDialog() {
  const settings = useApp((s) => s.snapshot!.settings),
    storage = useApp((s) => s.snapshot!.storage),
    researching = useApp((s) => s.snapshot!.runs.some((run) => run.status === 'running')),
    command = useApp((s) => s.command),
    open = useApp((s) => s.open)
  const [form, setForm] = useState<SettingsInput>({ ...settings, apiKey: '', searchKey: '' }),
    [models, setModels] = useState<string[]>([]),
    [testing, setTesting] = useState(false),
    [saving, setSaving] = useState(false),
    [choosingDirectory, setChoosingDirectory] = useState(false),
    [relocating, setRelocating] = useState(false),
    [storageSelection, setStorageSelection] = useState<{
      directory: string
      token: string
    } | null>(null),
    [connection, setConnection] = useState<ConnectionResult | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const update = (patch: Partial<SettingsInput>) => setForm((current) => ({ ...current, ...patch }))
  async function save(close: boolean) {
    setSaving(true)
    setError('')
    try {
      await command({ type: 'save-settings', settings: form })
      setForm((current) => ({ ...current, apiKey: '', searchKey: '' }))
      if (close) open(null)
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function test() {
    setTesting(true)
    setMessage('')
    if (!(await save(false))) {
      setTesting(false)
      return
    }
    try {
      const result = await client.testConnection()
      setModels(result.models)
      setConnection(result)
      setMessage(
        result.account
          ? `ChatGPT ${result.account.plan.toUpperCase()} 已连接，使用 Codex 账号额度`
          : `连接成功${result.models.length ? `，发现 ${result.models.length} 个可用模型` : '，服务暂未列出模型，可手动填写名称'}`,
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : '连接失败')
    } finally {
      setTesting(false)
    }
  }
  async function chooseDirectory() {
    setChoosingDirectory(true)
    setError('')
    try {
      const selection = await client.storage!.chooseDirectory()
      if (selection) setStorageSelection(selection)
    } catch (error) {
      setError(error instanceof Error ? error.message : '未能选择保存位置')
    } finally {
      setChoosingDirectory(false)
    }
  }
  async function relocate() {
    if (!storageSelection || !client.storage) return
    setRelocating(true)
    setMessage('')
    if (!(await save(false))) {
      setRelocating(false)
      return
    }
    try {
      await flushViewNow()
      await client.storage.relocate(storageSelection.token)
      setMessage('研究资料已校验，正在重启并启用新位置…')
    } catch (error) {
      setError(error instanceof Error ? error.message : '迁移未完成，仍使用原保存位置')
      setRelocating(false)
    }
  }
  return (
    <Modal
      title="模型与本地存储"
      description="模型在你选择的节点上工作，报告与研究记录保存在本地。"
      wide
      locked={relocating}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save(true)
        }}
      >
        <fieldset className="settings-fields" disabled={relocating}>
          <div className="provider-options">
            <button
              type="button"
              className={form.provider === 'codex' ? 'selected' : ''}
              onClick={() => {
                update({ provider: 'codex', model: '', jsonMode: false })
                setConnection(null)
                setMessage('')
              }}
            >
              <Sparkles size={18} />
              <strong>Codex 账号</strong>
              <span>沿用本机 ChatGPT 登录与 Codex 额度</span>
              {form.provider === 'codex' && <Check size={14} />}
            </button>
            <button
              type="button"
              className={form.provider === 'compatible' ? 'selected' : ''}
              onClick={() =>
                update({
                  provider: 'compatible',
                  baseUrl: 'https://api.openai.com/v1',
                  model: '',
                  jsonMode: false,
                })
              }
            >
              <PlugZap size={18} />
              <strong>兼容 OpenAI 的服务</strong>
              <span>OpenAI、兼容网关与本地服务</span>
              {form.provider === 'compatible' && <Check size={14} />}
            </button>
            <button
              type="button"
              className={form.provider === 'ollama' ? 'selected' : ''}
              onClick={() =>
                update({
                  provider: 'ollama',
                  baseUrl: 'http://127.0.0.1:11434',
                  model: '',
                  jsonMode: true,
                })
              }
            >
              <Settings2 size={18} />
              <strong>Ollama</strong>
              <span>在自己的设备上运行模型</span>
              {form.provider === 'ollama' && <Check size={14} />}
            </button>
          </div>
          {form.provider === 'codex' && (
            <>
              <div className="codex-connection-note">
                由本机 Codex 完成对话。请先在 Codex 登录 ChatGPT 账号，再点击“测试连接”；QB
                不读取或复制登录凭据。
              </div>
              <label className="field">
                Codex 程序路径 <span>可选</span>
                <input
                  value={form.codexPath ?? ''}
                  onChange={(event) => update({ codexPath: event.target.value })}
                  placeholder="留空自动查找本机 Codex 程序"
                />
                <small>Windows 使用 codex.exe；macOS / Linux 使用可执行的 codex 程序。</small>
              </label>
            </>
          )}
          {form.provider !== 'codex' && (
            <label className="field">
              服务地址
              <input
                type="url"
                required
                value={form.baseUrl}
                onChange={(event) => update({ baseUrl: event.target.value })}
              />
              <small>
                {form.provider === 'ollama'
                  ? '例如 http://127.0.0.1:11434，需先启动本地 Ollama 服务。'
                  : '填写 API 根地址，例如 https://api.openai.com/v1。'}
              </small>
            </label>
          )}
          <div className="form-row">
            <label className="field">
              模型名称
              <input
                required={form.provider !== 'codex'}
                value={form.model}
                list="available-models"
                onChange={(event) => update({ model: event.target.value })}
                placeholder={
                  form.provider === 'codex' ? '留空使用 Codex 默认模型' : '填写服务提供的模型标识'
                }
              />
              <datalist id="available-models">
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
            {form.provider === 'codex' ? (
              <div className="codex-account-summary">
                <span>使用当前 Codex 登录</span>
                <strong>
                  {connection?.account
                    ? `ChatGPT ${connection.account.plan.toUpperCase()}`
                    : '等待测试连接'}
                </strong>
                <small>{connection?.account?.email ?? '无需在 QB 填写 API Key'}</small>
              </div>
            ) : (
              <label className="field">
                API Key{' '}
                <span>
                  {form.provider === 'ollama'
                    ? '可选'
                    : settings.hasApiKey
                      ? '已保存'
                      : '按服务要求填写'}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={form.apiKey}
                  onChange={(event) => update({ apiKey: event.target.value })}
                  placeholder={settings.hasApiKey ? '留空保留已保存的密钥' : '在本地填写密钥'}
                />
              </label>
            )}
          </div>
          {form.provider !== 'codex' && (
            <>
              <div className="settings-divider">
                <span>外部资料检索</span>
                <span className="optional-tag">可选</span>
              </div>
              <label className="field">
                Tavily API Key <span>{settings.hasSearchKey ? '已保存' : ''}</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={form.searchKey}
                  onChange={(event) => update({ searchKey: event.target.value })}
                  placeholder={
                    settings.hasSearchKey
                      ? '留空保留已保存的密钥'
                      : '检索公开网页并把来源交给研究模型'
                  }
                />
                <small>未配置时，模型基于已有报告与自身知识分析，并在报告中说明资料局限。</small>
              </label>
            </>
          )}
          <details className="advanced-settings">
            <summary>
              上下文与输出设置 <ChevronRight size={13} />
            </summary>
            <label className="field">
              单次输入预算 <span>估算 tokens</span>
              <input
                type="number"
                min={4000}
                max={128000}
                step={1000}
                value={form.contextBudget}
                onChange={(event) => update({ contextBudget: Number(event.target.value) })}
              />
              <small>根据模型的实际上下文容量设置，并为输出保留余量。</small>
            </label>
            {form.provider !== 'codex' && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.jsonMode}
                  onChange={(event) => update({ jsonMode: event.target.checked })}
                />
                启用 JSON 输出模式<span>需要模型服务支持</span>
              </label>
            )}
            {settings.hasApiKey && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={!!form.clearApiKey}
                  onChange={(event) => update({ clearApiKey: event.target.checked })}
                />
                清除已保存的模型密钥
              </label>
            )}
            {settings.hasSearchKey && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={!!form.clearSearchKey}
                  onChange={(event) => update({ clearSearchKey: event.target.checked })}
                />
                清除已保存的检索密钥
              </label>
            )}
          </details>
          <div className="settings-privacy">
            <span className="save-dot" />
            {form.provider === 'codex'
              ? 'Codex 登录由 Codex 管理；对话与报告保存在本机。'
              : '密钥由本地进程保存，不进入研究导出文件。'}
          </div>
          {storage && (
            <div className="storage-location">
              <div className="storage-heading">
                <strong>
                  <FolderOpen size={15} />
                  研究保存位置
                </strong>
                {client.storage && storage.source !== 'environment' && (
                  <Button
                    type="button"
                    onClick={() => void chooseDirectory()}
                    disabled={choosingDirectory || saving || testing}
                  >
                    <FolderOpen size={13} />
                    {choosingDirectory ? '正在选择…' : '选择文件夹'}
                  </Button>
                )}
              </div>
              <code>{storage.database}</code>
              <small>保存全部研究空间、节点、对话、报告、历史及设置。</small>
              {storage.source === 'environment' ? (
                <small>此位置由启动环境 QUESTBRANCH_DATA_DIR 指定；移除该覆盖后可在此选择。</small>
              ) : !client.storage ? (
                <small>浏览器预览可通过启动环境 QUESTBRANCH_DATA_DIR 指定保存位置。</small>
              ) : (
                <small>可选择其他磁盘上的空文件夹。迁移校验后自动重启，原目录保留为备份。</small>
              )}
              {storageSelection && (
                <div className="storage-destination">
                  <span>新保存位置</span>
                  <code>{storageSelection.directory}</code>
                  <div className="storage-actions">
                    <small>
                      {researching
                        ? '请等待当前对话或研究结束，再进行迁移。'
                        : '当前设置与未发送的草稿会一起保存。'}
                    </small>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void relocate()}
                      disabled={researching || saving || testing || choosingDirectory}
                    >
                      {relocating ? (
                        <LoaderCircle size={13} className="spin" />
                      ) : (
                        <Check size={13} />
                      )}
                      {relocating ? '正在迁移…' : '迁移并重启'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {message && (
            <p className="inline-success" role="status">
              <Check size={14} />
              {message}
            </p>
          )}
          {form.provider === 'codex' && connection?.usage && (
            <div className="codex-usage">
              {connection.usage.map((window, index) => (
                <span key={index}>
                  {window.windowDurationMins
                    ? `${window.windowDurationMins / 60} 小时窗口`
                    : '额度窗口'}
                  ：剩余 {Math.max(0, 100 - window.usedPercent).toFixed(0)}%
                  {window.resetsAt
                    ? ` · ${new Date(window.resetsAt * 1000).toLocaleString('zh-CN')} 重置`
                    : ''}
                </span>
              ))}
            </div>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer split">
            <Button
              type="button"
              onClick={() => void test()}
              disabled={testing || saving || choosingDirectory}
            >
              {testing ? <LoaderCircle size={14} className="spin" /> : <PlugZap size={14} />}
              测试连接
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || testing || choosingDirectory}
            >
              {saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}保存设置
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
function SearchDialog() {
  const [query, setQuery] = useState(''),
    snapshot = useApp((s) => s.snapshot)!,
    workspaceId = useApp((s) => s.workspaceId),
    select = useApp((s) => s.select),
    open = useApp((s) => s.open)
  const nodes = snapshot.nodes
    .filter(
      (n) =>
        n.workspaceId === workspaceId &&
        (n.title + n.question + n.summary).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .slice(0, 40)
  return (
    <Modal title="在思路中寻找" description="搜索当前研究空间的问题与阶段摘要。">
      <div className="search-field">
        <Search size={18} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入一个问题、方向或关键词…"
          aria-label="搜索研究节点"
        />
      </div>
      <div className="search-results">
        {nodes.map((node) => (
          <button
            key={node.id}
            onClick={() => {
              select(node.id)
              open(null)
            }}
          >
            <span className="tiny-square" style={{ background: node.color }} />
            <div>
              <strong>{node.title}</strong>
              <small>{node.summary || '尚未形成研究报告'}</small>
            </div>
            <span className={`status ${nodeStatus(node, snapshot).key}`}>
              {nodeStatus(node, snapshot).label}
            </span>
          </button>
        ))}
        {!nodes.length && <p className="search-empty">没有找到相关研究，可以尝试换一个关键词。</p>}
      </div>
    </Modal>
  )
}
function CompareDialog() {
  const state = useApp(),
    snapshot = state.snapshot!,
    workspace = snapshot.workspaces.find((w) => w.id === state.workspaceId)!,
    nodes = snapshot.nodes.filter((n) => n.workspaceId === workspace.id),
    latest = nodes
      .map((n) => snapshot.reports.filter((r) => r.nodeId === n.id).at(-1))
      .filter((r) => !!r)
  const [a, setA] = useState(latest[0]?.id ?? ''),
    [b, setB] = useState(latest[1]?.id ?? ''),
    [instruction, setInstruction] = useState(
      '比较这两个方向的一致、冲突与互补之处，形成新的综合认识，并提出值得继续的问题。',
    ),
    [working, setWorking] = useState(false),
    [error, setError] = useState('')
  const reports = [latest.find((r) => r.id === a), latest.find((r) => r.id === b)]
  async function synthesize() {
    if (!snapshot.settings.model && snapshot.settings.provider !== 'codex') {
      state.open('settings')
      return
    }
    if (!reports[0] || !reports[1] || a === b) return
    setWorking(true)
    try {
      const result = await state.command({
        type: 'create-node',
        parentId: workspace.rootId,
        question: `综合研究：${reports[0].title}与${reports[1].title}`,
        relatedIds: [reports[0].nodeId, reports[1].nodeId],
      })
      state.select(result.id!)
      await state.command({
        type: 'start-research',
        nodeId: result.id!,
        instruction,
        reportIds: [a, b],
      })
      state.open(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : '综合研究未启动')
    } finally {
      setWorking(false)
    }
  }
  return (
    <Modal
      title="让不同分支的认识相遇"
      description="先并排理解两份报告，再由你决定是否开展综合研究。"
      wide
    >
      {latest.length < 2 ? (
        <div className="notice">至少需要两个节点分别保存报告，才能进行分支比较。</div>
      ) : (
        <>
          <div className="comparison-columns">
            {reports.map((report, i) => (
              <div className="compare-column" key={i}>
                <label className="field">
                  {i === 0 ? '研究方向 A' : '研究方向 B'}
                  <select
                    aria-label={i === 0 ? '研究方向 A' : '研究方向 B'}
                    value={i === 0 ? a : b}
                    onChange={(event) => (i === 0 ? setA : setB)(event.target.value)}
                  >
                    {latest.map((r) => (
                      <option key={r.id} value={r.id}>
                        {nodes.find((n) => n.id === r.nodeId)!.title}
                      </option>
                    ))}
                  </select>
                </label>
                {report && (
                  <>
                    <h3>{report.title}</h3>
                    <p>{report.summary}</p>
                    <div className="section-label">已有认识</div>
                    <ul>
                      {report.findings.map((finding, i) => (
                        <li key={i}>{finding}</li>
                      ))}
                    </ul>
                    <div className="section-label">尚待弄清</div>
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
          <label className="field">
            综合研究指令
            <textarea
              rows={3}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              maxLength={12000}
            />
          </label>
          <div className="notice">
            <CircleHelp size={14} />
            综合结果保存在新的研究节点中，两份原始报告继续保留。
          </div>
        </>
      )}
      {error && <p className="inline-error">{error}</p>}
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => state.open(null)}>
          关闭
        </Button>
        {latest.length >= 2 && (
          <Button variant="primary" onClick={() => void synthesize()} disabled={working || a === b}>
            {working ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{' '}
            {snapshot.settings.model || snapshot.settings.provider === 'codex'
              ? '开展综合研究'
              : '先连接研究模型'}
          </Button>
        )}
      </div>
    </Modal>
  )
}
