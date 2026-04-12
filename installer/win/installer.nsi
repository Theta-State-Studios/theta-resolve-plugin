Unicode True

!ifndef VERSION
  !define VERSION "1.0.0"
!endif

!define APP_NAME    "Theta Review"
!define PUBLISHER   "Theta State Studios"
!define APP_ID      "com.theta-studios.review"
!define INSTALL_DIR "$APPDATA\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\Theta Review"

Name            "${APP_NAME} ${VERSION}"
OutFile         "ThetaReview-${VERSION}-windows.exe"
InstallDir      "${INSTALL_DIR}"
RequestExecutionLevel user
ShowInstDetails show
SetCompressor   lzma

; Pages
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_ICON "..\..\Theta Review\img\icon.png"
!define MUI_WELCOMEPAGE_TITLE "Theta Review ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT  "This will install the Theta Review plugin for DaVinci Resolve.$\r$\n$\r$\nThe plugin will be placed in:$\r$\n$APPDATA\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\$\r$\n$\r$\nClick Install to continue."
!define MUI_FINISHPAGE_TITLE  "Installation Complete"
!define MUI_FINISHPAGE_TEXT   "Theta Review has been installed.$\r$\n$\r$\nRestart DaVinci Resolve, then open the plugin from:$\r$\nWorkspace → Workflow Integrations → Theta Review"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; Remove previous install
  RMDir /r "$INSTDIR"

  SetOutPath "$INSTDIR"
  File /r "plugin\*"

  DetailPrint ""
  DetailPrint "Installed to: $INSTDIR"
  DetailPrint "Restart DaVinci Resolve to load the plugin."
SectionEnd
