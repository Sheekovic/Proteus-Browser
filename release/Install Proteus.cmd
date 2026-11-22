@echo off
rem Installs this Proteus for you: a copy in your own programs folder, and a shortcut
rem in the Start menu and on the desktop. It asks for no administrator rights.
rem Proteus also runs from this folder as it is: "Start Proteus.cmd".
title Install Proteus
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
