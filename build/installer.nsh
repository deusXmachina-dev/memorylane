!ifndef INSTALL_MODE_PER_ALL_USERS
!macro customInit
  ReadRegStr $R6 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R6 != ""
    StrCpy $R7 "$R6\${UNINSTALL_FILENAME}"
    ${if} ${FileExists} "$R7"
      InitPluginsDir
      StrCpy $R8 "$PLUGINSDIR\per-machine-uninstaller.exe"
      CopyFiles /SILENT "$R7" "$R8"
      ExecShellWait "runas" "$R8" '/S /KEEP_APP_DATA /allusers --updated _?=$R6' SW_HIDE
      ClearErrors
    ${else}
      DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
      DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
    ${endif}
  ${endif}
!macroend
!endif
