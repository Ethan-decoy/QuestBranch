import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// A separate Electron profile keeps manual folder-picker/relaunch checks off real user data.
const artifacts = resolve('artifacts')
mkdirSync(artifacts, { recursive: true })
const root =
  process.env.QUESTBRANCH_VERIFY_PROFILE ?? mkdtempSync(join(artifacts, 'storage-verification-'))
const location = resolve(root)
if (
  !location.startsWith(artifacts + sep) ||
  relative(artifacts, location) !== basename(location) ||
  !basename(location).startsWith('storage-verification-')
)
  throw new Error('Storage verification must use its own artifacts directory')
process.env.QUESTBRANCH_VERIFY_PROFILE = location
delete process.env.QUESTBRANCH_DATA_DIR
const profile = join(location, 'profile')
const destination = join(location, '自选保存位置')
mkdirSync(profile, { recursive: true })
mkdirSync(destination, { recursive: true })
app.setPath('userData', profile)
app.disableHardwareAcceleration()
const reopened = existsSync(join(profile, 'storage-location.json'))

function databaseContents(directory) {
  const db = new DatabaseSync(join(directory, 'research.sqlite'), { readOnly: true })
  try {
    const hash = createHash('sha256')
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
    const counts = {}
    for (const { name } of tables) {
      const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()
      counts[name] = rows.length
      hash.update(JSON.stringify([name, rows]))
    }
    return { counts, hash: hash.digest('hex') }
  } finally {
    db.close()
  }
}

app.on('before-quit', () => {
  if (!reopened && existsSync(join(profile, 'storage-location.json'))) {
    const directory = JSON.parse(
      readFileSync(join(profile, 'storage-location.json'), 'utf8'),
    ).directory
    const source = databaseContents(join(profile, 'research'))
    const target = databaseContents(directory)
    if (source.hash !== target.hash) throw new Error('Migrated database differs from the source')
    writeFileSync(
      join(location, 'migration.json'),
      JSON.stringify({ source, target, directory, sourceRetained: true }, null, 2),
    )
  }
})
app.on('browser-window-created', (_, window) => {
  window.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle('QuestBranch · 存储迁移验收')
  })
  window.webContents.once('did-finish-load', async () => {
    try {
      const snapshot = await window.webContents.executeJavaScript('window.questbranch.snapshot()')
      if (reopened) {
        const previous = JSON.parse(readFileSync(join(location, 'migration.json'), 'utf8'))
        const actual = databaseContents(snapshot.storage.directory)
        if (
          snapshot.storage.directory !== previous.directory ||
          actual.hash !== previous.target.hash
        )
          throw new Error('Restart did not restore the migrated research directory')
        writeFileSync(
          join(location, 'verified.json'),
          JSON.stringify(
            {
              ...previous,
              reopened: true,
              locationSource: snapshot.storage.source,
              workspaces: snapshot.workspaces.length,
              nodes: snapshot.nodes.length,
              reports: snapshot.reports.length,
            },
            null,
            2,
          ),
        )
        console.log(
          'Storage migration and restart verified:',
          JSON.stringify({
            root: location,
            directory: snapshot.storage.directory,
            counts: actual.counts,
          }),
        )
      } else {
        console.log(
          'Isolated storage verification ready:',
          JSON.stringify({ root: location, destination }),
        )
      }
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
})
await import('../out/main/index.js')
