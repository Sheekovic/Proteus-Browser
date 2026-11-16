@echo off
rem Starts the Proteus manager and opens it in your browser.
rem Keep this window open while you use Proteus; closing it stops the running profiles.
title Proteus
cd /d "%~dp0"
"%~dp0node\node.exe" "%~dp0manager\src\main.ts" --open
if errorlevel 1 pause
