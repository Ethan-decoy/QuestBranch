import { gt, prerelease, rcompare, valid } from 'semver'
import type { AppUpdateState, UpdateProblem } from '../app-updates'

export const releaseRepository = 'https://github.com/Ethan-decoy/QuestBranch'
export const releaseApi = 'https://api.github.com/repos/Ethan-decoy/QuestBranch/releases'

export function updateChannel(version: string) {
  return String(prerelease(version)?.[0] ?? 'latest')
}

export interface AppRelease {
  version: string
  native: boolean
}

export interface UpdateTransport {
  latest(): Promise<AppRelease | null>
  download(release: AppRelease, progress: (percent: number) => void): Promise<void>
  install(): void | Promise<void>
  openRelease(version?: string): Promise<void>
}

// GitHub supplies discovery only. Keep navigation and download feeds on the fixed public repo.
export function selectRelease(
  input: unknown,
  current: string,
  feedSuffix: '' | '-linux' | '-safe-linux' | undefined,
): AppRelease | null {
  if (!Array.isArray(input)) throw new Error('Invalid release catalog')
  const channel = updateChannel(current)
  const releases: AppRelease[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid release entry')
    const { tag_name: tag, draft, prerelease: preview, assets } = entry
    if (typeof tag !== 'string' || typeof draft !== 'boolean' || typeof preview !== 'boolean')
      throw new Error('Invalid release identity')
    const version = tag.startsWith('v') ? tag.slice(1) : ''
    if (!valid(version) || draft || !gt(version, current)) continue
    const candidateChannel = updateChannel(version)
    if (candidateChannel !== 'latest' && candidateChannel !== channel) continue
    if (candidateChannel === 'latest' && preview) continue
    if (!Array.isArray(assets)) throw new Error('Invalid release assets')
    releases.push({
      version,
      native:
        feedSuffix !== undefined &&
        assets.some((asset) => asset?.name === `${candidateChannel}${feedSuffix}.yml`),
    })
  }
  return releases.sort((a, b) => rcompare(a.version, b.version))[0] ?? null
}

export class DesktopUpdates {
  private value: AppUpdateState
  private release: AppRelease | null = null
  private pending: Promise<AppUpdateState> | undefined

  constructor(
    version: string,
    private readonly transport: UpdateTransport,
    private readonly busy: () => boolean,
    private readonly log: (phase: string, error?: unknown) => void,
    private readonly native: boolean,
  ) {
    this.value = {
      currentVersion: version,
      channel: updateChannel(version),
      installation: native ? 'native' : 'manual',
      phase: 'idle',
    }
  }

  state(): AppUpdateState {
    return { ...this.value }
  }

  get installing() {
    return this.value.phase === 'installing'
  }

  private change(patch: Partial<AppUpdateState>) {
    this.value = { ...this.value, problem: undefined, ...patch }
    this.log(this.value.phase)
  }

  failed(problem: UpdateProblem, error: unknown) {
    this.change({ phase: problem === 'install' ? 'ready' : 'error', problem })
    this.log(problem, error)
  }

  check(): Promise<AppUpdateState> {
    if (this.pending) return this.pending
    // A downloaded update must not be lost because a startup timer or another panel checks again.
    if (this.value.phase === 'ready' || this.installing) return Promise.resolve(this.state())
    this.change({ phase: 'checking' })
    this.pending = (async () => {
      try {
        const release = await this.transport.latest()
        if (release && !gt(release.version, this.value.currentVersion))
          throw new Error('Update must be newer than the installed version')
        this.release = release
        this.change({
          phase: release ? 'available' : 'current',
          availableVersion: release?.version,
          checkedAt: new Date().toISOString(),
          progress: undefined,
          installation: this.native && release?.native !== false ? 'native' : 'manual',
        })
      } catch (error) {
        this.failed('check', error)
      }
      return this.state()
    })().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  download(): Promise<AppUpdateState> {
    if (this.pending) return this.pending
    if (!this.native || !this.release?.native || this.value.phase === 'ready' || this.installing)
      return Promise.resolve(this.state())
    const release = this.release
    this.change({ phase: 'downloading', progress: 0 })
    this.pending = (async () => {
      try {
        await this.transport.download(release, (percent) => {
          if (Number.isFinite(percent)) this.value.progress = Math.max(0, Math.min(100, percent))
        })
        this.change({ phase: 'ready', progress: 100 })
      } catch (error) {
        this.failed('download', error)
      }
      return this.state()
    })().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  async install(): Promise<AppUpdateState> {
    if (this.pending || this.value.phase !== 'ready') return this.state()
    if (this.busy()) {
      this.change({ problem: 'busy' })
      return this.state()
    }
    // No await between the idle check and the write barrier used by desktop IPC.
    this.change({ phase: 'installing' })
    try {
      await this.transport.install()
    } catch (error) {
      this.failed('install', error)
    }
    return this.state()
  }

  openRelease() {
    return this.transport.openRelease(this.release?.version)
  }
}
