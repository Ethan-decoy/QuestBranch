# Install and update QuestBranch

[简体中文](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/desktop-installation.md) · English

Download a published version from [Releases](https://github.com/Ethan-decoy/QuestBranch/releases). Application packages do not require Node.js or pnpm. Match your OS and CPU, and verify the file against that version's `SHA256SUMS.txt`. The assets actually attached to the release define what is available.

## Choose a package

| Platform             | Asset                                 | Installation                                                             |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Windows x64          | `QuestBranch-Setup-…-x64.exe`         | Run the current-user installer; choose the program directory.            |
| Windows x64 portable | `QuestBranch-…-windows-x64.zip`       | Extract the whole archive and run the top-level `Start-QuestBranch.cmd`. |
| macOS Apple Silicon  | `QuestBranch-…-macos-arm64.dmg`       | Open the disk image and drag QuestBranch to Applications.                |
| macOS Intel          | `QuestBranch-…-macos-x64.dmg`         | Use the Intel DMG and the same installation steps.                       |
| Linux x64            | `QuestBranch-…-linux-amd64.deb`       | Install with the system package manager; recommended on Ubuntu.          |
| Linux x64 portable   | `QuestBranch-…-linux-x86_64.AppImage` | Run `chmod +x filename.AppImage`, then `./filename.AppImage`.            |

Native Mac packages are verified on macOS 15 on both architectures; Linux packages on Ubuntu 24.04 x64. Other OS versions, distributions, desktop environments and ARM Linux are not covered. Each release records its actual installation and runtime checks.

## First-launch conditions

Windows packages are unsigned. Mac packages have verified ad-hoc signatures, without Developer ID or Apple notarization; the system may block first launch. Follow the app-specific information in System Settings → Privacy & Security. SHA-256 checks file bytes, not publisher identity.

Prefer the DEB on Ubuntu. It uses electron-builder's desktop integration, sandbox helper and AppArmor integration. The AppImage does not require FUSE2; its upstream launcher selects Chromium sandbox behavior based on user-namespace support and may fall back to `--no-sandbox` on restricted systems. Different Linux environments do not provide identical isolation conditions.

The DEB recommends `fonts-noto-cjk`. AppImage users need a system CJK font; install one with the distribution's package manager if Chinese text appears as boxes. OS credential-store support, including a Linux desktop keyring, affects credential protection; not every backend is verified.

## Research and credentials

Open Settings → Local storage to inspect the actual research path and available relocation controls. Installed applications and the browser preview have separate default locations. `QUESTBRANCH_DATA_DIR` overrides the saved location.

The Windows portable launch script uses adjacent `data/research/`, `data/profile/` and `data/codex/` directories. Run the script consistently to preserve that isolation; directly launching the EXE can open ordinary desktop data. See the [Windows guide](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/windows-trial.en.md).

Create a new research space for your own question, then connect a model or agent. The example can be read without credentials. For a first complete workflow, see [getting started](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/getting-started.en.md).

Local-first storage does not make cloud model calls offline. Cloud services and external tools receive the material used for configured requests. Research JSON excludes model credentials and external agent work files.

## Update and recover

1. Stop active work, quit normally, and back up research plus application/agent configuration that you need to retain.
2. Windows: run the new installer. Mac: replace the application. DEB: update with the package manager. AppImage: download and replace the file. There are no automatic or hot updates.
3. Reopen the same profile and research location; check questions, reports, conversations, sources and model connections.

Portable Windows data does not automatically merge into an installed application's research. To move between isolated configurations or systems, export a research space as JSON and import it into the new location; reconnect credentials separately. Retain complete backups when native sessions and external agent files are required.

Removing the installed application preserves research but is not a backup. Retain the portable `data/` directory separately from program files. To roll back, use a compatible application and its pre-upgrade backup; reinstalling an old package does not downgrade the database.

Mac/Linux checks cover fresh install, same-version reinstall, research retention and removal; upgrades from earlier native packages are not verified. Windows verifies an upgrade from the actual published `.5` installer. The checks use local model/OAuth/agent fixtures, not all real accounts or long-running workloads. `VERIFICATION.json` identifies the accepted source and checks.

See [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/faq.en.md) and the [Windows upgrade guide](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/windows-trial.en.md). Report problems in [Issues](https://github.com/Ethan-decoy/QuestBranch/issues), including version, OS/CPU, package type and steps, without credentials or private research.
