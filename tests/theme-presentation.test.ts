import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { nodeStatus } from '../src/ui/research-status'
import { branchDisplayPalette, displayBranchColor } from '../src/ui/theme-colors'
import { palette } from '../src/research/types'

describe('theme before the first paint', () => {
  const bootstrap = readFileSync(new URL('../src/ui/public/theme-init.js', import.meta.url), 'utf8')
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['invalid', true, 'light'],
    [null, true, 'light'],
  ])('restores %s with system dark=%s as %s', (saved, systemDark, expected) => {
    const root = { dataset: {}, style: {} }
    const metadata: Record<string, string> = {}
    runInNewContext(bootstrap, {
      document: {
        documentElement: root,
        querySelector: (selector: string) => ({
          setAttribute: (_name: string, value: string) => (metadata[selector] = value),
        }),
      },
      localStorage: { getItem: () => saved },
      window: { matchMedia: () => ({ matches: systemDark }) },
    })
    expect(root.dataset).toEqual({
      theme: expected,
      themeMode: saved === 'system' || saved === 'dark' ? saved : 'light',
    })
    expect(root.style).toEqual({
      colorScheme: expected,
      backgroundColor: expected === 'dark' ? '#101213' : '#f6f7f7',
    })
    expect(metadata['meta[name="color-scheme"]']).toBe(expected)
    expect(metadata['meta[name="theme-color"]']).toBe(expected === 'dark' ? '#101213' : '#f6f7f7')
  })
  it('can start when persistent browser storage is unavailable', () => {
    const root = { dataset: {}, style: {} }
    expect(() =>
      runInNewContext(bootstrap, {
        document: { documentElement: root, querySelector: () => null },
        localStorage: {
          getItem: () => {
            throw Error('Storage blocked')
          },
        },
      }),
    ).not.toThrow()
    expect(root.dataset).toEqual({ theme: 'light', themeMode: 'light' })
  })
})

const node = { id: 'current' }
describe('research state presentation', () => {
  it('keeps available reports visible after a cancelled continuation', () => {
    expect(
      nodeStatus(node, {
        runs: [{ nodeId: node.id, status: 'cancelled' }],
        reports: [{ nodeId: node.id }],
      }),
    ).toEqual({ key: 'ready', label: '已有认识' })
  })
  it('keeps completed discussion available after a cancelled follow-up', () => {
    expect(
      nodeStatus(node, {
        runs: [
          { nodeId: node.id, status: 'completed', mode: 'chat' },
          { nodeId: node.id, status: 'cancelled' },
        ],
        reports: [],
      }),
    ).toEqual({ key: 'discussed', label: '已开展讨论' })
  })
  it('distinguishes a failed run, interruption and current discussion', () => {
    expect(
      nodeStatus(node, {
        runs: [{ nodeId: node.id, status: 'failed' }],
        reports: [{ nodeId: node.id }],
      }).key,
    ).toBe('failed')
    expect(
      nodeStatus(node, {
        runs: [{ nodeId: node.id, status: 'interrupted' }],
        reports: [{ nodeId: node.id }],
      }).key,
    ).toBe('interrupted')
    expect(
      nodeStatus(node, {
        runs: [{ nodeId: node.id, status: 'running', mode: 'chat' }],
        reports: [],
      }).label,
    ).toBe('讨论中')
  })
  it('does not borrow another node run or claim research is complete', () => {
    expect(
      nodeStatus(node, { runs: [{ nodeId: 'other', status: 'running' }], reports: [] }),
    ).toEqual({ key: 'pending', label: '待研究' })
    expect(nodeStatus(node, { runs: [], reports: [{ nodeId: node.id }] })).toEqual({
      key: 'ready',
      label: '已有认识',
    })
  })
})

const luminance = (color: string) =>
  [1, 3, 5]
    .map((index) => parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
const contrast = (a: string, b: string) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
describe('branch identity in both themes', () => {
  it('maps all five existing identities without rewriting their stored values', () => {
    expect(Object.keys(branchDisplayPalette)).toEqual(palette)
    const identities = [...palette]
    for (const theme of ['light', 'dark'] as const) {
      const output = identities.map((color) => displayBranchColor(color, theme))
      expect(new Set(output).size).toBe(5)
      for (const [index, color] of identities.entries())
        expect(displayBranchColor(color.toUpperCase(), theme)).toBe(output[index])
    }
    expect(identities).toEqual(palette)
  })
  it('keeps native and imported markers visible on ordinary and selected surfaces', () => {
    const backgrounds = {
      light: ['#f6f7f7', '#ffffff', '#f5f5f6', '#def2e8'],
      dark: ['#101213', '#24272a', '#363b41', '#234234'],
    }
    for (const theme of ['light', 'dark'] as const)
      for (const color of [
        ...palette,
        '#000000',
        '#ffffff',
        '#ffff00',
        '#00ff00',
        '#0000ff',
        '#ff00ff',
        '#101213',
        '#234234',
        '#def2e8',
      ]) {
        const result = displayBranchColor(color, theme)
        expect(result).toMatch(/^#[a-f0-9]{6}$/)
        for (const background of backgrounds[theme])
          expect(contrast(result, background)).toBeGreaterThanOrEqual(3)
      }
  })
  it('uses a visible fallback for invalid imported colors', () => {
    for (const theme of ['light', 'dark'] as const)
      for (const invalid of ['', 'constructor', 'transparent', '#fff'])
        expect(displayBranchColor(invalid, theme)).toBe(displayBranchColor(palette[0], theme))
  })
})
