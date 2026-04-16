Unicode True

!ifndef VERSION
  !define VERSION "1.0.0"
!endif

!define APP_NAME    "Theta Review"
!define PUBLISHER   "Theta State Studios"
!define APP_ID      "com.theta-studios.review"
!define REL_PATH    "Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\Theta Review"

Name            "${APP_NAME} ${VERSION}"
OutFile         "ThetaReview-${VERSION}-windows.exe"
InstallDir      "" ; overridden at runtime via Function .onInit
RequestExecutionLevel admin
ShowInstDetails show
SetCompressor   lzma

; Pages
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!ifdef ICONFILE
  !define MUI_ICON "${ICONFILE}"
!endif
!define MUI_WELCOMEPAGE_TITLE "Theta Review ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT  "This will install the Theta Review plugin for DaVinci Resolve.$\r$\n$\r$\nThe plugin will be placed in:$\r$\nC:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\$\r$\n$\r$\nAdministrator access is required. Click Install to continue."
!define MUI_FINISHPAGE_TITLE  "Installation Complete"
!define MUI_FINISHPAGE_TEXT   "Theta Review has been installed.$\r$\n$\r$\nRestart DaVinci Resolve, then open the plugin from:$\r$\nWorkspace $\x2192 Workflow Integrations $\x2192 Theta Review"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

; Resolve install dir at runtime using the PROGRAMDATA environment variable
Function .onInit
  ReadEnvStr $0 PROGRAMDATA
  StrCpy $INSTDIR "$0\${REL_PATH}"
FunctionEnd

Section "Install"
  ; Remove previous install
  RMDir /r "$INSTDIR"

  ; Explicitly create the full directory tree
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "plugin\*"

  DetailPrint ""
  DetailPrint "Installed to: $INSTDIR"
  DetailPrint "Restart DaVinci Resolve to load the plugin."
SectionEnd
