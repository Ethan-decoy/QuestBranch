# Windows installation and upgrades

[简体中文](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/windows-trial.md) · English

Applies to **0.3.0-dev.9 · Windows x64 prerelease**. No Node.js or pnpm is required. Get the actual packages and checksums from [Releases](https://github.com/Ethan-decoy/QuestBranch/releases).

## Installed application

1. Download `QuestBranch-Setup-0.3.0-dev.9-x64.exe` and `SHA256SUMS.txt` for the same release, then verify the hash.
2. Run the current-user installer and choose a program directory. Administrator installation is not required.
3. Open QB, read the example or create your own research. Connect your model or agent before starting an AI conversation.

```powershell
Get-FileHash .\QuestBranch-Setup-0.3.0-dev.9-x64.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

The installed app uses normal desktop configuration and your saved research location. Inspect or relocate research in Settings → Local storage. Uninstall retains data, including a custom research location; keep independent backups.

## Isolated portable trial

Download `QuestBranch-0.3.0-dev.9-windows-x64.zip`, verify its checksum and extract the entire archive into a writable directory. Keep `win-unpacked/` intact; do not distribute or copy only the EXE. Launch with the top-level `Start-QuestBranch.cmd`.

The script puts research, Electron configuration and bundled Codex configuration into adjacent `data/research/`, `data/profile/` and `data/codex/` directories. They may contain personal content or credentials and should not be shared with feedback.

Directly running `win-unpacked/QuestBranch.exe` uses normal desktop paths and can open daily data. Always use the script for an isolated trial. Default projects are under `data/research/projects/`; projects in custom folders need separate backups and do not move with the trial directory. Settings can still move the current project. Global connections are in `data/profile/application.sqlite`. Custom ACP backends retain their own account and working-directory rules, which the script cannot fully isolate.

Windows packages are unsigned and may trigger source or SmartScreen notices. The checksum verifies integrity rather than code signing. The release's verification and notes describe the actual status.

## Upgrade an installed application

Installed editions offer **Settings → About** for checks, downloads and restart-to-install; ZIP/directory editions update manually. From dev.6 or earlier, install this version manually once. See the [installation guide](desktop-installation.en.md) for backup and recovery.

Stop active work and quit QB. Export important spaces and back up the research directory and configuration. Run the new installer, retaining the intended program and data locations. Reopen and check reports, sources, conversations and connections. This release uses the actual published dev.7 installer as its predecessor.

The portable ZIP's `data/` is separate and is not automatically merged. Export/import research JSON when moving from a portable trial to the installed app; credentials and native state need separate handling.

## Upgrade a portable trial or recover data

1. Quit and back up the complete old `data/` directory.
2. Extract the new package into an empty directory rather than mixing old and new application files.
3. Copy the backed-up data into the new trial and use its launch script. Never run two instances against the same directory.
4. Check the research and reconnect credentials when necessary.

Research format 3 can import formats 1 and 2. JSON contains the research trail, not credentials, external agent files or complete native-session state; it is not a full application backup. Old applications are not guaranteed to read newer data. Roll back with the old app and a complete pre-upgrade backup, rather than just replacing the EXE.

## Scope and help

The installer and complete ZIP are checked in an isolated runner, including actual installation, upgrade, SDK handoff/relaunch, research reopen, import and uninstall retention. Fixed responses do not establish coverage of every real provider. See [installation conditions](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/desktop-installation.en.md) and `VERIFICATION.json` for the actual scope.

See [your first research](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/getting-started.en.md) and [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/faq.en.md). Report version, OS, connection type and reproducible steps in [Issues](https://github.com/Ethan-decoy/QuestBranch/issues), removing credentials and private research first.
