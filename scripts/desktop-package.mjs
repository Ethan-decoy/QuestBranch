import { join, resolve } from 'node:path'

export function option(name, fallback) {
  return (
    process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
  )
}

// Package structure is an OS concern; the same research checks run on every OS.
export function desktopPackage(root = option('package-root')) {
  const platform = process.platform
  const defaults = {
    win32: 'release/win-unpacked',
    darwin: `release/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/QuestBranch.app`,
    linux: 'release/linux-unpacked',
  }
  if (!defaults[platform]) throw new Error(`Unsupported desktop platform: ${platform}`)
  root = resolve(root ?? defaults[platform])
  const contents = platform === 'darwin' ? join(root, 'Contents') : root
  const resources = join(contents, platform === 'darwin' ? 'Resources' : 'resources')
  const executable =
    platform === 'darwin'
      ? join(contents, 'MacOS/QuestBranch')
      : join(root, platform === 'win32' ? 'QuestBranch.exe' : 'questbranch')
  return { root, contents, resources, executable, archive: join(resources, 'app.asar') }
}
