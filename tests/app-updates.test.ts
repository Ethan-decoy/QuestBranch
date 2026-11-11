import { describe, expect, it, vi } from 'vitest'
import {
  DesktopUpdates,
  selectRelease,
  type AppRelease,
  type UpdateTransport,
} from '../src/desktop/app-updates'

const release: AppRelease = { version: '0.3.0-dev.7', native: true }
function catalog(version: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes('-'),
    assets: [{ name: 'dev.yml' }],
    ...extra,
  }
}
function fixture(native = true) {
  let active = false
  const transport: UpdateTransport = {
    latest: vi.fn(async () => release),
    download: vi.fn(async (_release, progress) => {
      progress(73)
    }),
    install: vi.fn(),
    openRelease: vi.fn(async () => {}),
  }
  const updates = new DesktopUpdates('0.3.0-dev.6', transport, () => active, vi.fn(), native)
  return {
    updates,
    transport,
    busy: (value: boolean) => {
      active = value
    },
  }
}

describe('published update selection', () => {
  it('follows the installed channel, excludes drafts and downgrades, compares SemVer numerically', () => {
    expect(
      selectRelease(
        [
          catalog('0.3.0-dev.5'),
          catalog('0.3.0-dev.10'),
          catalog('0.3.0-dev.9'),
          catalog('0.4.0-beta.1'),
          catalog('0.4.0-dev.1', { draft: true }),
        ],
        '0.3.0-dev.6',
        '',
      ),
    ).toEqual({ version: '0.3.0-dev.10', native: true })
    expect(selectRelease([catalog('0.4.0-dev.1')], '0.3.0', '')).toBeNull()
    expect(selectRelease([catalog('0.3.0-dev.6')], '0.3.0-dev.6', '')).toBeNull()
  })
  it('can graduate a preview to stable, using the target channel metadata', () => {
    expect(
      selectRelease([catalog('0.3.0', { assets: [{ name: 'latest.yml' }] })], '0.3.0-dev.6', ''),
    ).toEqual({ version: '0.3.0', native: true })
    expect(selectRelease([catalog('0.3.0', { prerelease: true })], '0.3.0-dev.6', '')).toBeNull()
  })
  it('offers manual download when a release has no native feed or the client is portable', () => {
    expect(selectRelease([catalog('0.3.0-dev.7', { assets: [] })], '0.3.0-dev.6', '')?.native).toBe(
      false,
    )
    expect(selectRelease([catalog('0.3.0-dev.7')], '0.3.0-dev.6', undefined)?.native).toBe(false)
    expect(
      selectRelease(
        [catalog('0.3.0-dev.7', { assets: [{ name: 'dev-linux.yml' }] })],
        '0.3.0-dev.6',
        '-linux',
      )?.native,
    ).toBe(true)
  })
  it('treats malformed catalogs as failures instead of claiming the application is current', () => {
    expect(() => selectRelease({ message: 'rate limited' }, '0.3.0-dev.6', '')).toThrow()
    expect(() => selectRelease([{}], '0.3.0-dev.6', '')).toThrow()
  })
  it('offers manual installation to legacy AppImage clients and a native feed to safe clients', () => {
    const releases = [catalog('0.3.0-dev.8', { assets: [{ name: 'dev-safe-linux.yml' }] })]
    expect(selectRelease(releases, '0.3.0-dev.7', '-linux')?.native).toBe(false)
    expect(selectRelease(releases, '0.3.0-dev.7', '-safe-linux')?.native).toBe(true)
  })
})

describe('desktop update lifecycle', () => {
  it('checks, downloads, preserves a ready update across checks, installs and relaunches only explicitly', async () => {
    const { updates, transport } = fixture()
    expect((await updates.check()).phase).toBe('available')
    expect(transport.download).not.toHaveBeenCalled()
    expect((await updates.download()).phase).toBe('ready')
    await updates.check()
    expect(transport.latest).toHaveBeenCalledTimes(1)
    expect(transport.install).not.toHaveBeenCalled()
    expect((await updates.install()).phase).toBe('installing')
    await updates.install()
    expect(transport.install).toHaveBeenCalledTimes(1)
  })
  it('blocks restart while research, auth or relocation is active, and does not queue a hidden restart', async () => {
    const { updates, transport, busy } = fixture()
    await updates.check()
    await updates.download()
    busy(true)
    expect(await updates.install()).toMatchObject({ phase: 'ready', problem: 'busy' })
    expect(updates.installing).toBe(false)
    busy(false)
    await updates.check()
    expect(transport.install).not.toHaveBeenCalled()
    await updates.install()
    expect(transport.install).toHaveBeenCalledTimes(1)
    expect(updates.installing).toBe(true)
  })
  it('deduplicates in-flight downloads and keeps progress stable during concurrent checks', async () => {
    const { updates, transport } = fixture()
    let finish!: () => void
    vi.mocked(transport.download).mockImplementation(async (_release, progress) => {
      progress(41)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    await updates.check()
    const download = updates.download()
    expect(updates.download()).toBe(download)
    expect(updates.check()).toBe(download)
    expect(updates.state()).toMatchObject({ phase: 'downloading', progress: 41 })
    finish()
    await download
    expect(updates.state().phase).toBe('ready')
    expect(transport.download).toHaveBeenCalledTimes(1)
  })
  it('never reports a failed discovery as current and permits retry', async () => {
    const { updates, transport } = fixture()
    vi.mocked(transport.latest).mockRejectedValueOnce(new Error('HTTP 403'))
    expect(await updates.check()).toMatchObject({ phase: 'error', problem: 'check' })
    expect((await updates.check()).phase).toBe('available')
  })
  it('retains the selected release after a failed checksum/download and permits retry', async () => {
    const { updates, transport } = fixture()
    vi.mocked(transport.download).mockRejectedValueOnce(new Error('SHA512 mismatch'))
    await updates.check()
    expect(await updates.download()).toMatchObject({
      phase: 'error',
      problem: 'download',
      availableVersion: release.version,
    })
    expect((await updates.install()).phase).toBe('error')
    expect(transport.install).not.toHaveBeenCalled()
    expect((await updates.download()).phase).toBe('ready')
  })
  it('releases the write barrier and preserves the ready update if the installer cannot start', async () => {
    const { updates, transport } = fixture()
    vi.mocked(transport.install).mockImplementationOnce(() => {
      throw new Error('Spawn failed')
    })
    await updates.check()
    await updates.download()
    expect(await updates.install()).toMatchObject({ phase: 'ready', problem: 'install' })
    expect(updates.installing).toBe(false)
    expect((await updates.install()).phase).toBe('installing')
  })
  it('blocks concurrent installs until asynchronous filesystem preparation finishes', async () => {
    const { updates, transport } = fixture()
    let failPreparation!: (error: Error) => void
    vi.mocked(transport.install).mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          failPreparation = reject
        }),
    )
    await updates.check()
    await updates.download()
    const installing = updates.install()
    expect(updates.installing).toBe(true)
    expect((await updates.install()).phase).toBe('installing')
    expect(transport.install).toHaveBeenCalledTimes(1)
    failPreparation(new Error('ENOSPC'))
    expect(await installing).toMatchObject({ phase: 'ready', problem: 'install' })
    expect(updates.installing).toBe(false)
  })
  it('manual builds only navigate to the official selected release', async () => {
    const { updates, transport } = fixture(false)
    vi.mocked(transport.latest).mockResolvedValue({ ...release, native: false })
    await updates.check()
    await updates.download()
    await updates.install()
    expect(transport.download).not.toHaveBeenCalled()
    expect(transport.install).not.toHaveBeenCalled()
    await updates.openRelease()
    expect(transport.openRelease).toHaveBeenCalledWith(release.version)
  })
})
