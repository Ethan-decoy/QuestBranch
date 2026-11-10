export type UpdatePhase =
  'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'

export type UpdateProblem = 'check' | 'download' | 'install' | 'busy'

export interface AppUpdateState {
  currentVersion: string
  channel: string
  installation: 'native' | 'manual'
  phase: UpdatePhase
  availableVersion?: string
  progress?: number
  checkedAt?: string
  problem?: UpdateProblem
}

export interface AppUpdates {
  state(): Promise<AppUpdateState>
  check(): Promise<AppUpdateState>
  download(): Promise<AppUpdateState>
  install(): Promise<AppUpdateState>
  openRelease(): Promise<void>
}
