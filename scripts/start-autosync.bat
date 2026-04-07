@echo off
cd /d %~dp0..
powershell -ExecutionPolicy Bypass -File ".\scripts\auto-sync.ps1" -IntervalSeconds 60 -Branch dev
