import { t } from '../../i18n'
import { useState } from 'react'
import { Check, FolderOpen, LoaderCircle } from 'lucide-react'
import { Button } from '../components'
import { flushViewNow, useApp } from '../state'
import { client } from '../client'
import { useTranslation } from 'react-i18next'

export function useStorageSettings({
  setError,
  setMessage,
}: {
  setError(message: string): void
  setMessage(message: string): void
}) {
  const storage = useApp((s) => s.snapshot!.storage)
  const researching = useApp((s) =>
    s.snapshot!.runs.some(
      (run) =>
        s.snapshot!.workspaces.some(
          (workspace) =>
            workspace.id === run.workspaceId && workspace.projectId === s.snapshot!.activeProjectId,
        ) && run.status === 'running',
    ),
  )
  const [choosingDirectory, setChoosingDirectory] = useState(false)
  const [relocating, setRelocating] = useState(false)
  const [storageSelection, setStorageSelection] = useState<{
    directory: string
    token: string
  } | null>(null)
  async function chooseDirectory() {
    setChoosingDirectory(true)
    setError('')
    try {
      const selection = await client.storage!.chooseDirectory()
      if (selection) setStorageSelection(selection)
    } catch (error) {
      setError(error instanceof Error ? error.message : t('未能选择保存位置'))
    } finally {
      setChoosingDirectory(false)
    }
  }
  async function relocate() {
    if (!storageSelection || !client.storage) return
    setRelocating(true)
    try {
      await flushViewNow()
      await client.storage.relocate(storageSelection.token)
      await useApp.getState().refresh()
      setStorageSelection(null)
      setMessage('')
    } catch (error) {
      setError(error instanceof Error ? error.message : t('迁移未完成，仍使用原保存位置'))
    } finally {
      setRelocating(false)
    }
  }

  return {
    storage,
    researching,
    choosingDirectory,
    relocating,
    storageSelection,
    setStorageSelection,
    chooseDirectory,
    relocate,
  }
}
export function StorageSettingsPanel({
  controller,
}: {
  controller: ReturnType<typeof useStorageSettings>
}) {
  const { t } = useTranslation()
  const {
    storage,
    researching,
    choosingDirectory,
    relocating,
    storageSelection,
    setStorageSelection,
    chooseDirectory,
    relocate,
  } = controller
  return (
    <>
      {storage && (
        <div className="storage-location settings-storage">
          <div className="storage-heading">
            <strong>
              <FolderOpen size={15} />
              {t('项目文件夹')}
            </strong>
            {client.storage && (client.projects || storage.source !== 'environment') && (
              <Button
                type="button"
                onClick={() => void chooseDirectory()}
                disabled={choosingDirectory || relocating}
              >
                <FolderOpen size={13} />
                {choosingDirectory ? t('正在选择…') : t('迁移此项目')}
              </Button>
            )}
          </div>
          <code>{storage.directory}</code>
          {storage.legacy && <small>{t('已有研究 · 可迁移整个项目，或从研究菜单单独移动')}</small>}
          {storage.source === 'environment' && <small>{t('由启动配置指定')}</small>}
          {storageSelection && (
            <div className="storage-destination">
              <span>{t('新保存位置')}</span>
              <code>{storageSelection.directory}</code>
              <small>{t('项目内全部研究、草稿和 QB 会话状态一起迁移，原位置保留备份。')}</small>
              <small>{t('不移动文件夹内的其他文件及外部智能体资料。')}</small>
              <div className="storage-actions">
                <small>
                  {researching ? t('请等待当前对话或研究结束。') : t('仅迁移当前项目。')}
                </small>
                <Button type="button" variant="ghost" onClick={() => setStorageSelection(null)}>
                  {t('取消')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void relocate()}
                  disabled={researching || relocating || choosingDirectory}
                >
                  {relocating ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}
                  {relocating ? t('正在迁移…') : t('迁移项目')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
