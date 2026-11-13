export interface ReleaseAsset {
  id: number
  name: string
  digest?: string | null
  browser_download_url: string
}
export interface DesktopRelease {
  id: number
  tag_name: string
  draft: boolean
  target_commitish: string
  assets: ReleaseAsset[]
  body?: string | null
}
export const releaseRepository: string
export function selectPreviousRelease(
  releases: DesktopRelease[],
  current: string,
): {
  version: string
  sourceCommit: string
  assets: Record<'zip' | 'installer' | 'appImage', { name: string; url: string; sha256: string }>
}
export function retiredInstallerAssets(
  releases: DesktopRelease[],
  before: string,
  current: string,
): DesktopRelease[]
export function readReleaseCatalog(): Promise<DesktopRelease[]>
