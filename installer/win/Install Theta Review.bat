@echo off
setlocal

set DEST=%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\Theta Review

echo ================================================
echo   Theta Review Plugin Installer
echo ================================================
echo.

if exist "%DEST%" (
    echo Removing previous install...
    rmdir /s /q "%DEST%"
)

echo Installing plugin...
mkdir "%DEST%"
xcopy /e /i /q "%~dp0plugin\*" "%DEST%\"

echo.
echo Installed to:
echo   %DEST%
echo.
echo Restart DaVinci Resolve to load the plugin.
echo (Workspace ^> Workflow Integrations ^> Theta Review)
echo.
pause
