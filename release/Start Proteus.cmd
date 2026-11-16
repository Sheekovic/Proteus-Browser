@echo off
rem Starts Proteus and shows its window.
rem This console stays open while Proteus runs; closing it stops the running profiles.
title Proteus
cd /d "%~dp0"
"%~dp0node\node.exe" "%~dp0manager\src\main.ts" --open
if errorlevel 1 pause
