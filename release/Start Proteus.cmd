@echo off
rem Starts Proteus and shows its window. Started again while it runs, it shows the
rem window again.
rem This console stays open while Proteus runs; closing it stops the running profiles.
title Proteus
cd /d "%~dp0"
rem The Node.js that came in this folder, or else the one installed on this computer.
set "NODE=%~dp0node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0manager\src\main.ts" --open
if errorlevel 1 pause
