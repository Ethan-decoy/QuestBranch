import { useEffect, useState } from 'react'
import { Check, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { version } from '../../../package.json'
import type { AppUpdateState } from '../../app-updates'
import { client } from '../client'
import { flushViewNow } from '../state'
import { Button, Feedback } from '../components'

export function UpdatesPanel() {
  const [state, setState] = useState<AppUpdateState>()
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const { t } = useTranslation()
  useEffect(() => {
    if (!client.updates) return
    let mounted = true
    const refresh = () =>
      client.updates!.state().then(
        (next) => {
          if (mounted) setState(next)
        },
        () => {
          if (mounted) setFailed(true)
        },
      )
    void refresh()
    const timer = setInterval(() => void refresh(), 750)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])
  const working =
    saving ||
    state?.phase === 'checking' ||
    state?.phase === 'downloading' ||
    state?.phase === 'installing'
  async function act(action: 'check' | 'download' | 'install') {
    if (!client.updates) return
    setFailed(false)
    setSaving(true)
    try {
      if (action === 'install') await flushViewNow()
      setState(await client.updates[action]())
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }
  async function openRelease() {
    try {
      await client.updates!.openRelease()
    } catch {
      setFailed(true)
    }
  }
  return (
    <>
      <h3 className="settings-section-title">{t('关于')}</h3>
      <div className="settings-preference-group">
        <div className="settings-preference-row">
          {/* i18next-instrument-ignore-next-line: brand name */}
          <strong>QuestBranch</strong>
          <span className="update-version">v{state?.currentVersion ?? version}</span>
        </div>
        {state && (
          <div className="settings-preference-row">
            <strong>{t('更新通道')}</strong>
            <span>
              {state.channel === 'latest'
                ? t('稳定版')
                : t('预览版 · {{channel}}', { channel: state.channel })}
            </span>
          </div>
        )}
        <div className="settings-preference-row update-action-row">
          <div className="update-status" role="status" aria-live="polite">
            {working && <LoaderCircle size={15} className="spin" aria-hidden="true" />}
            {state?.phase === 'current' && <Check size={15} aria-hidden="true" />}
            <span>
              {!client.updates
                ? t('请在桌面应用中检查更新')
                : !state
                  ? failed
                    ? t('检查新版本')
                    : t('正在读取更新状态')
                  : state.phase === 'checking'
                    ? t('正在检查更新')
                    : state.phase === 'current'
                      ? t('已是当前通道最新版本')
                      : state.phase === 'downloading'
                        ? t('正在下载 · {{percent}}%', { percent: Math.floor(state.progress ?? 0) })
                        : state.phase === 'ready'
                          ? t('更新已就绪')
                          : state.phase === 'installing'
                            ? t('正在重启并安装')
                            : state.availableVersion
                              ? t('可更新至 {{version}}', { version: state.availableVersion })
                              : t('检查新版本')}
            </span>
          </div>
          {client.updates && (
            <Button
              type="button"
              disabled={(!state && !failed) || working}
              onClick={() => {
                if (state?.phase === 'ready') void act('install')
                else if (state?.availableVersion && state.problem !== 'check') {
                  if (state.installation === 'native') void act('download')
                  else void openRelease()
                } else void act('check')
              }}
            >
              {state?.phase === 'ready' ? (
                <RefreshCw size={14} />
              ) : state?.availableVersion ? (
                <Download size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              {state?.phase === 'ready'
                ? t('重启并更新')
                : state?.availableVersion && state.problem !== 'check'
                  ? state.installation === 'native'
                    ? t('下载更新')
                    : t('前往下载')
                  : t('检查更新')}
            </Button>
          )}
        </div>
        {state?.phase === 'downloading' && (
          <progress
            className="update-progress"
            aria-label={t('更新下载进度')}
            value={state.progress ?? 0}
            max={100}
          />
        )}
      </div>
      {state?.installation === 'manual' && (
        <p className="update-hint">{t('此安装方式需下载新版后手动安装。')}</p>
      )}
      {state?.problem === 'busy' && (
        <Feedback tone="warning">{t('请在研究、账号连接或资料迁移结束后重启更新。')}</Feedback>
      )}
      {(failed || (state?.problem && state.problem !== 'busy')) && (
        <Feedback tone="error">
          {failed
            ? t('操作未完成，请重试；未保存的内容不会被丢弃。')
            : state?.problem === 'check'
              ? t('无法检查更新，请检查网络后重试。')
              : state?.problem === 'download'
                ? t('更新下载或校验失败，请重试。')
                : t('无法启动更新，请重试或手动下载安装。')}
        </Feedback>
      )}
      {client.updates ? (
        <button type="button" className="update-release-link" onClick={() => void openRelease()}>
          <ExternalLink size={13} />
          {t('发行说明')}
        </button>
      ) : (
        <a
          className="update-release-link"
          href="https://github.com/Ethan-decoy/QuestBranch/releases"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} />
          {t('发行说明')}
        </a>
      )}
    </>
  )
}
