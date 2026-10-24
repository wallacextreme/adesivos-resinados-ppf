@echo off
chcp 65001 > nul
title Sportinox — Gerador de Instaladores Windows (.exe e .msi)

echo ========================================================================
echo    SPORTINOX — GERADOR DE INSTALADORES NATIVOS WINDOWS (.EXE E .MSI)
echo    Arquitetura Offline-First (Tauri v2 + Rust + NSIS + WiX)
echo ========================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_windows_installers.ps1"

echo.
pause
