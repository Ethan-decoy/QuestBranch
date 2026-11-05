import { defineConfig } from 'i18next-cli'

export default defineConfig({
  locales: ['zh-CN', 'en'],
  extract: {
    input: ['src/ui/**/*.{ts,tsx}', 'src/dsh/frame.ts'],
    ignore: ['src/ui/locales/**', 'src/ui/research-status.ts'],
    output: 'src/ui/locales/{{language}}.json',
    primaryLanguage: 'zh-CN',
    secondaryLanguages: ['en'],
    // A product checkout may omit another host's source while sharing its catalog.
    removeUnusedKeys: false,
    keySeparator: false,
    nsSeparator: false,
    defaultValue: (key, _namespace, language, value) =>
      language === 'zh-CN' ? value || key.replace(/_(?:zero|one|two|few|many|other)$/, '') : '',
    sort: true,
    instrumentScorer: (content) => (/\p{Script=Han}/u.test(content) ? 1 : null),
  },
  status: { checkIdentical: 'error' },
})
