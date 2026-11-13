import { useState } from 'react'
import { FolderOpen, LoaderCircle, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, Feedback } from '../components'
import { flushViewNow, useApp } from '../state'
import { client } from '../client'

export function ProjectDialog() {
  const { t } = useTranslation(),
    state = useApp()
  const [name, setName] = useState(''),
    [folder, setFolder] = useState(state.projectFolder),
    [requestId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <Modal title={folder?.existing ? t('打开项目') : t('新建项目')}>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError('')
          try {
            if (folder?.existing) {
              await flushViewNow()
              await client.projects!.open(folder.token)
              await useApp.getState().refresh()
            } else {
              await state.projectCommand({
                type: 'create-project',
                name,
                requestId,
                directoryToken: folder?.token,
              })
            }
            state.open(null)
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error))
          } finally {
            setBusy(false)
          }
        }}
      >
        {!folder?.existing && (
          <label className="field">
            {t('项目名称')}
            <input
              autoFocus
              required
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('例如：产品研究、论文阅读')}
            />
          </label>
        )}
        <div className="field">
          {folder?.existing ? t('项目文件夹') : t('保存位置')}
          <div className="project-folder-row">
            <code title={folder?.directory}>{folder?.directory ?? t('默认项目位置')}</code>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const selected = await client.projects!.chooseDirectory()
                  if (selected) {
                    setFolder(selected)
                    setError('')
                  }
                } catch (error) {
                  setError(String(error))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <FolderOpen size={14} />
              {t('选择文件夹')}
            </Button>
          </div>
        </div>
        {error && <Feedback tone="error">{error}</Feedback>}
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={() => state.open(null)} disabled={busy}>
            {t('取消')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || (!folder?.existing && !name.trim())}
          >
            {busy ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}{' '}
            {folder?.existing ? t('打开项目') : t('创建项目')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
