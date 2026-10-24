# 🎨 Sportinox — Catálogo Eletrônico Inteligente de Balcão (Adesivos Resinados & PPF)
### **Sistema Completo de Balcão Offline-First • PWA Instalável • Aplicativo Nativo Windows (.exe / .msi via Tauri v2)**

[![PWA Demo](https://img.shields.io/badge/🌐_Demo_Online_(PWA)-2563eb?style=for-the-badge&logo=pwa&logoColor=white)](https://wallacextreme.github.io/sportinox-catalogo-balcao/)
[![Tauri v2](https://img.shields.io/badge/Tauri_v2-Rust_Desktop-orange?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript_5.7-Strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-17/17_Pass_(100%25)-10b981?style=for-the-badge&logo=bun&logoColor=white)](tests/)
[![Quality Gates](https://img.shields.io/badge/Quality_Gates-10/10_Auditados-7c3aed?style=for-the-badge)](scripts/)
[![Performance](https://img.shields.io/badge/Busca_Latência-Sub--50ms_(1.2ms)-emerald?style=for-the-badge)](src/search/)

---

## 🎯 Sobre o Projeto

O **Sportinox — Catálogo Inteligente de Balcão** é uma solução de alta performance desenvolvida para autopeças, lojas de acessórios automotivos e balcões de atendimento que comercializam **adesivos resinados, emblemas automotivos, faixas decorativas, protetores de soleira e películas PPF**.

O sistema opera sob o paradigma **Offline-First Absoluto**: funciona 100% sem internet após o primeiro acesso, garantindo busca instantânea sub-50ms em um acervo com mais de **3.396 peças automotivas** e **3.435 imagens WebP em alta definição**.

Disponível tanto como **PWA instalável** (Desktop e Mobile) quanto como **aplicativo nativo Windows (`.exe` via NSIS e `.msi` via WiX)** construído sobre **Tauri v2 e Rust**.

---

## 🏆 Os 10 Quality Gates Auditados

| Quality Gate | Descrição Técnica | Status |
| :--- | :--- | :---: |
| **Gate 1 — Integridade dos PDFs** | 3.199 produtos extraídos via `PyMuPDF (fitz)` XREF sem perdas de registros de catálogo. | ✅ **100% Pass** |
| **Gate 2 — Fundo Branco Puro (#FFFFFF)** | Tratamento `SMask`, conversão `CMYK -> sRGB` e floodfill nos 4 cantos eliminando fundos escuros/cinzas. | ✅ **100% Pass** |
| **Gate 3 — Enriquecimento Web Multi-Ângulos** | 197 novos itens integrados via Playwright (Linha Pesada, Motos, Lançamentos) com concorrência `Semaphore(4)`. | ✅ **100% Pass** |
| **Gate 4 — WebP Near-Lossless** | Pipeline duplo de conversão automática (`method=6, quality=96`) preservando texturas e gravações. | ✅ **100% Pass** |
| **Gate 5 — Busca Sub-50ms** | Indexador multi-token em memória com busca aproximada homoglífica (`O↔0`, `I↔1`). Média: **1.2ms**. | ✅ **100% Pass** |
| **Gate 6 — 4 Naturezas de Vínculos** | Vínculos técnicos estritos com bloqueio de cross-category em `EQUIVALENCIA_DIRETA`. | ✅ **100% Pass** |
| **Gate 7 — Lightbox Studio 400%** | Zoom suave de 50% a 400% com arraste bidirecional (*pan*), carrossel multi-ângulos e suporte touch. | ✅ **100% Pass** |
| **Gate 8 — Isolamento Inviolável da Loja** | Preços, localização e estoque do lojista preservados intactos durante auto-syncs de catálogo. | ✅ **100% Pass** |
| **Gate 9 — Segurança, Concorrência e SHA-256** | Sanitização XSS estrita, validação de magic bytes, serialização `AsyncWriteQueue` e backup SHA-256. | ✅ **100% Pass** |
| **Gate 10 — PWA & Empacotamento Windows** | Service Worker offline, Web Manifest e instaladores Windows `.exe` e `.msi` via Tauri v2. | ✅ **100% Pass** |

---

## ⚡ Destaques de Arquitetura e Engenharia

```
                                  ARQUITETURA DO SISTEMA
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FONTES DE DADOS ORIGINAIS                              │
│   • sportinox_linha_leve.pdf (PyMuPDF XREF)        • industriasportinox.com (Playwright)│
│   • sportinox_universal.pdf (PyMuPDF XREF)         • sportinox.com.br (Playwright HD)  │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              PIPELINE DE PROCESSAMENTO PYTHON                          │
│   • Filtro Anti-Ruído (descarte de logos/selos por frequência multi-página > 3)        │
│   • Recomposição Alpha SMask sobre canvas branco puro (#FFFFFF)                        │
│   • Conversor WebP Studio Near-Lossless (Lanczos 1600px, quality 96, method 6)         │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             APLICAÇÃO CLIENT-SIDE OFFLINE-FIRST                        │
│   • IndexedDB Storage Engine (Write Queue + Auto-Sync Não-Destrutivo)                  │
│   • Motor de Busca Multi-Token Sub-50ms com tolerância homoglífica (CALI35 == CAL135)  │
│   • 4 Naturezas de Vínculos Técnicos (Variantes, Acoplamento, Kits e Equivalência)     │
│   • UI/UX Pro Max: Daylight Counter Mode (#F8FAFC) + Modo Escuro Calibrado (#0F172A)   │
│   • Lightbox Studio 400% HD com pan/zoom e Carrossel Multi-Ângulos                     │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
     ┌─────────────────────────────┐               ┌─────────────────────────────┐
     │        PWA INSTALÁVEL       │               │    DESKTOP WINDOWS NATIVO   │
     │  Service Worker Cache-First │               │  Tauri v2 + Rust Core       │
     │  Web Manifest Standalone    │               │  Instaladores .exe e .msi   │
     └─────────────────────────────┘               └─────────────────────────────┘
```

### 1. Mineração Binária de PDFs (`scripts/extract_catalogs_xref.py`)
- Jamais processa PDFs no navegador do usuário final.
- Utiliza **PyMuPDF (`fitz`)** para extrair imagens diretamente via tabela de objetos `xref`.
- **Filtro Anti-Ruído:** Varredura em todas as páginas contando a frequência de cada imagem; qualquer `xref` repetido em mais de 3 páginas (logos, selos ISO, cabeçalhos) é automaticamente descartado.
- Recomposição Alpha nativa (`SMask`) sobre fundo branco puro `#FFFFFF`, eliminando peças com fundo escuro.

### 2. Enriquecimento Web Multi-Ângulos (`scripts/enrich_catalog_playwright.py`)
- Automação via **Microsoft Playwright Headless** com controle de concorrência (`asyncio.Semaphore(4)`).
- Captura de fotos de estúdio em alta definição de todos os ângulos disponíveis da peça (frontal, traseira, detalhes de bicos e conectores).
- Inclusão dos lançamentos de Linha Pesada (Caminhões) e Linha Motos.

### 3. Motor de Busca de Balcão Sub-50ms (`src/search/search-engine.ts`)
- Indexador multi-token em memória executando em **~1.2 milissegundos** sobre 3.396 produtos.
- **Tolerância Homoglífica:** Normalização automática de erros comuns de digitação em balcão (`O` por `0`, `I` por `1`), garantindo que `CALI35` encontre instantaneamente `CAL135`.
- **Filtro Rápido por Montadora Recolhível:** Menu moderno sanfona que despolui o visual com 1 clique e exibe badges inteligentes de filtros ativos.

### 4. Gestão de Balcão & Proteção Inviolável da Loja (`Gate 8 & 9`)
- Preços, códigos internos da loja, prateleiras/gavetas e estoque são mantidos isolados em `storeInventoryData`.
- Atualizações do catálogo oficial **jamais sobrescrevem** os dados financeiros ou de estoque da loja física.
- **Backup Criptográfico:** Exportação e restauração completa em JSON validada por checksum **SHA-256**.
- **Planilha CSV:** Exportação e importação instantânea de preços e localização física para integração com ERPs.

---

## 💻 Como Executar o Projeto Localmente

### Pré-requisitos
- [Bun](https://bun.sh/) (recomendado) ou Node.js 20+
- Python 3.10+ (apenas se for reexecutar os scripts de extração)
- Rust & Cargo (apenas para compilar o executável nativo do Tauri)

### Passos de Instalação

```bash
# 1. Clonar o repositório
git clone https://github.com/wallacextreme/sportinox-catalogo-balcao.git
cd sportinox-catalogo-balcao

# 2. Instalar dependências
bun install

# 3. Executar em modo desenvolvimento
bun run dev
```

Abra [http://localhost:5173](http://localhost:5173) no seu navegador.

---

## 🧪 Executando os Testes Automatizados

O projeto possui uma suíte rigorosa de 17 testes automatizados cobrindo os 10 Quality Gates:

```bash
bun test
```

Resultado dos testes:
```
tests/crud-inventory.test.ts:
  ✓ CRUD Completo + Fila de Concorrência
  ✓ Gate 8 — Isolamento Inviolável da Loja & Auto-Sync
  ✓ Gate 9 — Segurança XSS, Magic Bytes, Benchmark < 50ms e Ciclo Backup SHA-256
tests/currency.test.ts:
  ✓ Conversão BRL -> BigInt sem perda de ponto flutuante
  ✓ Formatação em Reais com separador de milhar
tests/image-gallery.test.ts:
  ✓ Conversor WebP client-side e deduplicação SHA-256
tests/normalizer.test.ts:
  ✓ Preservação de zeros à esquerda e remoção de pontuação
  ✓ Normalização homoglífica (O<->0, I<->1)
tests/relations-engine.test.ts:
  ✓ 4 Naturezas de vínculos e bloqueio cross-category
tests/units-and-years.test.ts:
  ✓ Conversão de medidas e anos de aplicação veicular

17 pass | 0 fail | 96 expect() calls
```

---

## 📦 Gerando os Instaladores para Windows (.exe e .msi)

### Opção 1: Script Automatizado em 1 Clique (Windows)
Dê um duplo clique no arquivo:
```cmd
scripts\build_windows_installers.bat
```
Ou execute via PowerShell:
```powershell
.\scripts\build_windows_installers.ps1
```

### Opção 2: Via Terminal Bun
```bash
# Gera o pacote PWA e compila o instalador .exe (NSIS)
bun run build:installer:exe

# Gera o pacote PWA e compila o instalador .msi (WiX)
bun run build:installer:msi

# Compila ambos (.exe e .msi)
bun run build:windows
```

Os arquivos finais serão salvos em:
- **Instalador `.exe` (NSIS):** `src-tauri/target/release/bundle/nsis/`
- **Instalador `.msi` (WiX):** `src-tauri/target/release/bundle/msi/`

---

## 🌐 Instalação como PWA (Progressive Web App)

1. Acesse o catálogo em [https://wallacextreme.github.io/sportinox-catalogo-balcao/](https://wallacextreme.github.io/sportinox-catalogo-balcao/)
2. No **Google Chrome** ou **Microsoft Edge**, clique no ícone de instalar na barra de endereços (`Instalar Sportinox Catálogo`).
3. No **celular (Android/iOS)**, selecione `Adicionar à tela de início`.
4. O catálogo agora funciona como um aplicativo independente, com ícone próprio e suporte offline contínuo.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend & PWA:** TypeScript 5.7, Tailwind CSS v4, Vite 6, Service Workers, Web Manifest.
- **Engine Desktop:** Tauri v2, Rust 1.96, NSIS, WiX Toolset.
- **Data Mining & OCR:** Python 3.12, PyMuPDF (`fitz`), Pillow, Microsoft Playwright.
- **Banco de Dados Local:** IndexedDB com fila de concorrência (`AsyncWriteQueue`).
- **Segurança & Criptografia:** Web Crypto API (SHA-256), Sanitização DOM HTML Defensiva.

---

## 👤 Autor

**Wallace de Paula Soares**  
*Desenvolvedor Full Stack & Engenheiro de Software*  
- **Portfólio:** [wallacextreme.github.io/portfolio](https://wallacextreme.github.io/portfolio/)  
- **GitHub:** [@wallacextreme](https://github.com/wallacextreme)  
- **LinkedIn:** [linkedin.com/in/wallacextreme](https://linkedin.com/in/wallacextreme)  
- **E-mail:** [wallacextreme@hotmail.com](mailto:wallacextreme@hotmail.com)  

---

## 📄 Licença

Este projeto está sob licença MIT. Consulte o arquivo [LICENSE](LICENSE) para mais informações.
