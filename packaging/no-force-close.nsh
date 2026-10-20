; Never close an unrelated session, even during a silent QA install.
; The updater must first save and shut down its own application.
!macro customCheckAppRunning
  StrCpy $R1 0
  ${Do}
    nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 != 0
      ${ExitDo}
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 >= 5
      IfSilent +2
        MessageBox MB_OK|MB_ICONEXCLAMATION "Save your work and close every Catalyst Foundry window, then run Setup again. Setup will not close your projects for you."
      SetErrorLevel 1618
      Quit
    ${EndIf}
    Sleep 1000
  ${Loop}
!macroend

!macro customInit
  !insertmacro customCheckAppRunning
!macroend
