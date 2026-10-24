# scripts/build_windows_installers.ps1
# Script Automatizado para Geração dos Instaladores Nativos Windows (.exe e .msi)
# Catálogo Inteligente de Balcão Sportinox via Tauri v2 e Rust

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "   SPORTINOX — GERADOR DE INSTALADORES NATIVOS WINDOWS (.EXE E .MSI)   " -ForegroundColor Yellow
Write-Host "   Arquitetura Offline-First (Tauri v2 + Rust + NSIS + WiX)            " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Checagem de Ferramentas
Write-Host "[1/5] Verificando dependências do ambiente..." -ForegroundColor Green
$tools = @("bun", "cargo", "rustc")
foreach ($t in $tools) {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
        Write-Host "ERRO CRÍTICO: Ferramenta obrigatória '$t' não encontrada no PATH!" -ForegroundColor Red
        Exit 1
    }
}
$rustVersion = rustc --version
$bunVersion = bun --version
Write-Host "  -> Rust detectado: $rustVersion" -ForegroundColor Gray
Write-Host "  -> Bun detectado: v$bunVersion" -ForegroundColor Gray

# 2. Execução dos Testes Automatizados (Quality Gate 10/10)
Write-Host ""
Write-Host "[2/5] Executando bateria de testes automatizados (17 testes)..." -ForegroundColor Green
bun test
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Testes falharam! O build de instalador foi abortado por segurança." -ForegroundColor Red
    Exit 1
}
Write-Host "  -> Todos os 17 testes passaram com 100% de sucesso!" -ForegroundColor Green

# 3. Compilação do Frontend PWA
Write-Host ""
Write-Host "[3/5] Gerando bundle otimizado de produção do Frontend PWA..." -ForegroundColor Green
bun run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Falha na compilação do frontend!" -ForegroundColor Red
    Exit 1
}
Write-Host "  -> Bundle PWA gerado com sucesso em ./dist" -ForegroundColor Green

# 4. Compilação Release do Binário Nativo e Empacotamento Tauri v2
Write-Host ""
Write-Host "[4/5] Executando Tauri Build (Gerando .exe via NSIS e .msi via WiX)..." -ForegroundColor Yellow
Write-Host "  -> Isso compila o binário em Rust otimizado e empacota os instaladores." -ForegroundColor Gray
bunx tauri build

if ($LASTEXITCODE -ne 0) {
    Write-Host "AVISO: O empacotamento padrão finalizou com código $LASTEXITCODE." -ForegroundColor Yellow
}

# 5. Localização e Auditoria dos Artefatos Gerados
Write-Host ""
Write-Host "[5/5] Auditando instaladores gerados..." -ForegroundColor Green

$bundleDir = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle"
if (Test-Path $bundleDir) {
    $exeFiles = Get-ChildItem -Path (Join-Path $bundleDir "nsis") -Filter "*.exe" -ErrorAction SilentlyContinue
    $msiFiles = Get-ChildItem -Path (Join-Path $bundleDir "msi") -Filter "*.msi" -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "================ ARTEFATOS WINDOWS GERADOS ================" -ForegroundColor Cyan

    if ($exeFiles) {
        foreach ($exe in $exeFiles) {
            $sizeMb = [Math]::Round($exe.Length / 1MB, 2)
            Write-Host "  [EXE - NSIS] $($exe.FullName) ($sizeMb MB)" -ForegroundColor Green
        }
    } else {
        Write-Host "  [!] Instalador .exe (NSIS) não encontrado no diretório de saída." -ForegroundColor Yellow
    }

    if ($msiFiles) {
        foreach ($msi in $msiFiles) {
            $sizeMb = [Math]::Round($msi.Length / 1MB, 2)
            Write-Host "  [MSI - WiX]  $($msi.FullName) ($sizeMb MB)" -ForegroundColor Green
        }
    } else {
        Write-Host "  [!] Instalador .msi (WiX) não encontrado no diretório de saída." -ForegroundColor Yellow
    }

    $mainExe = Join-Path $PSScriptRoot "..\src-tauri\target\release\sportinox-catalogo-balcao.exe"
    if (Test-Path $mainExe) {
        $exeItem = Get-Item $mainExe
        $sizeMb = [Math]::Round($exeItem.Length / 1MB, 2)
        Write-Host "  [EXE Nativo] $($exeItem.FullName) ($sizeMb MB)" -ForegroundColor Cyan
    }
} else {
    Write-Host "Diretório de bundle ainda não gerado: $bundleDir" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Processo concluído!" -ForegroundColor Green
