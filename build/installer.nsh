!ifndef INSTALL_MODE_PER_ALL_USERS
!macro customInit
  ReadRegStr $R6 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${if} $R6 != ""
    ReadRegStr $R9 HKCU "${INSTALL_REGISTRY_KEY}" PerMachineEvictionVersion
    ${if} $R9 != "${VERSION}"
    ${orifnot} ${Silent}
      WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" PerMachineEvictionVersion "${VERSION}"
      Push "$R6"
      Call GetInQuotes
      Pop $R7
      ${if} $R7 == ""
        StrCpy $R7 "$R6"
      ${endif}
      ${if} ${FileExists} "$R7"
        ReadRegStr $R8 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
        ${if} $R8 == ""
          Push "$R7"
          Call GetFileParent
          Pop $R8
        ${endif}
        InitPluginsDir
        CopyFiles /SILENT "$R7" "$PLUGINSDIR\per-machine-uninstaller.exe"
        ExecShellWait "runas" "$PLUGINSDIR\per-machine-uninstaller.exe" '/S /allusers _?=$R8' SW_HIDE
      ${endif}
      ClearErrors
    ${endif}
  ${endif}
!macroend
!endif
