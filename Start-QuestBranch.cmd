@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "QB_TRIAL_EXE=%~dp0win-unpacked\QuestBranch.exe"
if not exist "%QB_TRIAL_EXE%" set "QB_TRIAL_EXE=%~dp0release\win-unpacked\QuestBranch.exe"
if not exist "%QB_TRIAL_EXE%" (
  echo QuestBranch.exe was not found. Extract the complete Windows package first.
  pause
  exit /b 1
)
set "QUESTBRANCH_DATA_DIR=%~dp0data\research"
set "CODEX_HOME=%~dp0data\codex"
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_RENDERER_URL="
set "TAVILY_API_KEY="
start "" "%QB_TRIAL_EXE%" "--user-data-dir=%~dp0data\profile"
exit /b 0
