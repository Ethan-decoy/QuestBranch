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
  const researching = useApp((s) => s.snapshot!.runs.some((run) => run.status === 'running'))
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
      setMessage(t('研究资料已校验，正在重启并启用新位置…'))
    } catch (error) {
      setError(error instanceof Error ? error.message : t('迁移未完成，仍使用原保存位置'))
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
              {t('研究保存位置')}
            </strong>
            {client.storage && storage.source !== 'environment' && (
              <Button
                type="button"
                onClick={() => void chooseDirectory()}
                disabled={choosingDirectory || relocating}
              >
                <FolderOpen size={13} />
                {choosingDirectory ? t('正在选择…') : t('更改位置')}
              </Button>
            )}
          </div>
          <code>{storage.directory}</code>
          {storage.source === 'environment' && <small>{t('由启动配置指定')}</small>}
          {storageSelection && (
            <div className="storage-destination">
              <span>{t('新保存位置')}</span>
              <code>{storageSelection.directory}</code>
              <small>
                {t('迁移到空文件夹并校验后重启，原目录保留备份。当前设置与草稿会一起保存。')}
              </small>
              <div className="storage-actions">
                <small>
                  {researching
                    ? t('请等待当前对话或研究结束。')
                    : t('全部研究资料将迁移到新位置。')}
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
                  {relocating ? t('正在迁移…') : t('迁移并重启')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
