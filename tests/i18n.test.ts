import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n, { chooseLanguage, readLanguage, t } from '../src/i18n'
import { effortText, runtimeLabel, statusText } from '../src/ui/i18n-labels'

afterEach(async () => {
  vi.unstubAllGlobals()
  await i18n.changeLanguage('zh-CN')
})

describe('中文优先的界面语言', () => {
  it('首次使用、未知偏好及存储不可用时均选择中文', () => {
    expect(readLanguage()).toBe('zh-CN')
    expect(readLanguage({ getItem: () => 'en' })).toBe('en')
    expect(readLanguage({ getItem: () => 'fr' })).toBe('zh-CN')
    expect(
      readLanguage({
        getItem: () => {
          throw new Error('Storage blocked')
        },
      }),
    ).toBe('zh-CN')
    expect(t('设置')).toBe('设置')
  })

  it('英文切换即时生效，保存选择并更新文档语言', async () => {
    const values = new Map<string, string>()
    const document = { documentElement: { lang: 'zh-CN' } }
    vi.stubGlobal('document', document)
    vi.stubGlobal('localStorage', {
      setItem: (key: string, value: string) => values.set(key, value),
    })
    expect(await chooseLanguage('en')).toBe(true)
    expect(t('设置')).toBe('Settings')
    expect(t('目录')).toBe('Directory')
    expect(t('目录', { context: 'report', defaultValue: '目录' })).toBe('Contents')
    expect(document.documentElement.lang).toBe('en')
    expect(readLanguage({ getItem: (key) => values.get(key) ?? null })).toBe('en')
    await chooseLanguage('zh-CN')
    expect(t('设置')).toBe('设置')
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('无法写入偏好时仍完成本次切换，并明确报告未保存', async () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('Quota exceeded')
      },
    })
    expect(await chooseLanguage('en')).toBe(false)
    expect(t('界面语言')).toBe('Interface language')
  })

  it('按目标语言处理单复数，变量值作为文本保留', async () => {
    await i18n.changeLanguage('en')
    expect(t('{{count}} 个节点', { count: 1 })).toBe('1 node')
    expect(t('{{count}} 个节点', { count: 2 })).toBe('2 nodes')
    expect(t('展开 {{count}} 个子方向', { count: 1 })).toBe('Expand 1 child branch')
    const title = '保留原文 <script> & {{不再插值}}'
    expect(t('来源：{{title}} · v{{originVersion}}', { title, originVersion: 3 })).toBe(
      `Source: ${title} · v3`,
    )
    await i18n.changeLanguage('zh-CN')
    expect(t('{{count}} 个节点', { count: 2 })).toBe('2 个节点')
  })

  it('缺失或空的英文翻译回退中文，未知外部信息保持原样', async () => {
    i18n.addResource('zh-CN', 'translation', '测试中文回退', '中文回退内容')
    i18n.addResource('en', 'translation', '测试中文回退', '')
    await i18n.changeLanguage('en')
    expect(t('测试中文回退')).toBe('中文回退内容')
    expect(runtimeLabel('我的研究结论保持中文原文')).toBe('我的研究结论保持中文原文')
    expect(runtimeLabel('Provider tool: web_search')).toBe('Provider tool: web_search')
  })

  it('只在呈现时转换已知状态与强度，不改写记录中的标签', async () => {
    const status = { key: 'ready' as const, label: '已有研究记录' }
    await i18n.changeLanguage('en')
    expect(statusText(status)).toBe('Research recorded')
    expect(effortText('high')).toBe('High')
    expect(runtimeLabel('保存报告与研究方向')).toBe('Save report and branches')
    expect(status.label).toBe('已有研究记录')
    await i18n.changeLanguage('zh-CN')
    expect(statusText(status)).toBe('已有研究记录')
    expect(effortText('high')).toBe('高')
  })
})
