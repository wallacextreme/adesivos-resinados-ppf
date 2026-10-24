#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/enrich_catalog_playwright.py
PASSO 3 — Super-Enriquecimento Web Multi-Ângulos com Microsoft Playwright (Headless Chromium)
- Concorrência controlada via asyncio.Semaphore(4) e cache incremental em scripts/.playwright_scrape_cache.json.
- Conecta aos 2 catálogos web oficiais da Sportinox informados pelo usuário:
    1) https://sportinox.com.br/ (Loja Oficial Nuvemshop com fotos de estúdio multi-ângulos 1024x1024px)
    2) http://www.industriasportinox.com/index.html (Catálogo Oficial separado por Linhas: Lançamentos, Linha Pesada / Caminhões, Linha Motos e Linha Leve)
- Extrai TODAS as URLs de imagens originais de estúdio em Alta Definição (full-size / modal de zoom / CDN original)
  e gera ângulos extras (_2.webp, _3.webp, _4.webp) estritamente em lowercase via webp_studio_converter.py.
- Descubra e incorpora lançamentos, itens de Linha Pesada (Caminhões Ford, Scania, Iveco, MB, VW) e Linha Motos.
- Fallback Defensivo Obrigatório: preserva intacta a imagem .webp extraída via XREF do PDF no Passo 2 quando o código antigo não existir no e-commerce.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import quote_plus, urljoin

from playwright.async_api import BrowserContext, Page, async_playwright

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from webp_studio_converter import audit_webp_image, convert_bytes_to_studio_webp
from extract_catalogs_xref import (
    compute_seed_relationships,
    normalize_code_strict,
    normalize_sku_lower,
    parse_year_range_from_text,
    resolve_automaker_line_label,
)

DATA_DIR = PROJECT_ROOT / "src" / "data"
PUBLIC_IMAGES_ROOT = PROJECT_ROOT / "public" / "catalog-images"
SPORTINOX_IMAGES_DIR = PUBLIC_IMAGES_ROOT / "sportinox"
SEED_PATH = DATA_DIR / "catalog-master-seed.json"
CACHE_FILE_PATH = SCRIPT_DIR / ".playwright_scrape_cache.json"
SW_FILE_PATH = PROJECT_ROOT / "public" / "sw.js"


def load_scrape_cache() -> Dict[str, List[str]]:
    if CACHE_FILE_PATH.exists():
        try:
            return json.loads(CACHE_FILE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_scrape_cache(cache: Dict[str, List[str]]) -> None:
    CACHE_FILE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def promote_cdn_url_to_full_hd(url: str) -> str:
    """
    Promove miniaturas da CDN Nuvemshop/Mitiendanube (-50-0.webp, -100-0.webp, -320-0.webp, -480-0.webp, -640-0.webp)
    para a versão de estúdio em Alta Definição (-1024-1024.webp).
    """
    full = url.strip()
    if full.startswith("//"):
        full = "https:" + full
    full = re.sub(r"-\d{2,3}-0\.webp(\?.*)?$", "-1024-1024.webp", full)
    return full


def is_valid_studio_image_url(url: str) -> bool:
    low = url.lower()
    if low.startswith("data:") or low.endswith(".svg") or low.endswith(".gif"):
        return False
    blacklist = (
        "logo",
        "favicon",
        "banner",
        "themes/common",
        "whatsapp",
        "facebook",
        "instagram",
        "pesquisa.jpg",
        "jornal.jpg",
        "index.png",
        "texto.jpg",
    )
    return not any(b in low for b in blacklist)


async def extract_multi_angle_urls_from_sportinox_store(
    page: Page,
    sku_raw: str,
) -> List[str]:
    """
    Pesquisa um SKU na loja oficial https://sportinox.com.br/search/?q={sku},
    verifica se o código SKU bate na página, entra na página do produto e captura
    todos os ângulos de estúdio em alta resolução (1024x1024).
    """
    sku_norm = normalize_code_strict(sku_raw)
    search_url = f"https://sportinox.com.br/search/?q={quote_plus(sku_raw)}"

    try:
        resp = await page.goto(search_url, wait_until="domcontentloaded", timeout=15000)
        if not resp or resp.status >= 400:
            return []

        html = await page.content()
        # Verifica se o SKU consultado aparece nos dados estruturados da busca
        if f'"{sku_raw.upper()}"' not in html.upper() and f'"{sku_norm}"' not in html.upper():
            return []

        # Localiza o link da página de detalhes do produto correspondente
        product_href: Optional[str] = await page.evaluate(
            """(targetSku) => {
                const links = Array.from(document.querySelectorAll('a[href*="/produtos/"]'));
                for (const a of links) {
                    const card = a.closest('[data-product-id], .js-item-product, .item-product') || a;
                    if (card && card.innerHTML.toUpperCase().includes(targetSku.toUpperCase())) {
                        return a.href;
                    }
                }
                return links.length > 0 ? links[0].href : null;
            }""",
            sku_raw,
        )

        if not product_href:
            return []

        p_resp = await page.goto(product_href, wait_until="domcontentloaded", timeout=15000)
        if not p_resp or p_resp.status >= 400:
            return []

        # Extrai todas as imagens da galeria de produto da página oficial
        raw_imgs: List[str] = await page.evaluate(
            """() => {
                const urls = [];
                const push = (u) => {
                    if (u && typeof u === 'string') urls.push(u.trim());
                };
                // 1. Galeria principal do produto (Swiper / Fancybox / Product Gallery)
                const selectors = [
                    '.js-product-slide-img',
                    '[data-store^="product-image"] img',
                    '.product-slider-image',
                    'a.js-product-slide-link',
                    '[data-fancybox="product-gallery"]',
                    '.js-swiper-product img'
                ];
                for (const sel of selectors) {
                    for (const el of document.querySelectorAll(sel)) {
                        push(el.getAttribute('href'));
                        push(el.getAttribute('data-srcset'));
                        push(el.getAttribute('data-src'));
                        push(el.getAttribute('src'));
                    }
                }
                // 2. Fallback: todas as imagens de produtos da loja na seção principal
                if (urls.length === 0) {
                    for (const img of document.querySelectorAll('img[src*="/products/"], img[data-src*="/products/"]')) {
                        push(img.getAttribute('data-src') || img.getAttribute('src'));
                    }
                }
                return urls;
            }"""
        )

        final_urls: List[str] = []
        seen_hashes: Set[str] = set()
        for raw_u in raw_imgs:
            # Se for um srcset com múltiplas resoluções, pega a última
            parts = [p.strip().split(" ")[0] for p in raw_u.split(",") if p.strip()]
            candidate = parts[-1] if parts else raw_u
            promoted = promote_cdn_url_to_full_hd(candidate)
            if not is_valid_studio_image_url(promoted):
                continue
            # Deduplica pelo hash base da imagem na CDN Nuvemshop
            base_id_match = re.search(r"/products/([a-f0-9-]+)-\d+-\d+\.webp", promoted)
            dedup_key = base_id_match.group(1) if base_id_match else promoted
            if dedup_key not in seen_hashes:
                seen_hashes.add(dedup_key)
                final_urls.append(promoted)

        return final_urls[:6]
    except Exception:
        return []


async def discover_multi_angle_products_from_store_home(
    context: BrowserContext,
    limit: int = 35,
) -> Dict[str, List[str]]:
    """
    Navega na vitrine da loja oficial https://sportinox.com.br/ com Playwright
    para descobrir produtos com múltiplos ângulos de estúdio e mapear {sku_norm: [img1, img2, img3...]}.
    """
    sku_to_urls: Dict[str, List[str]] = {}
    page = await context.new_page()
    try:
        await page.goto("https://sportinox.com.br/", wait_until="domcontentloaded", timeout=20000)
        links: List[str] = await page.evaluate(
            """() => {
                const set = new Set();
                for (const a of document.querySelectorAll('a[href*="https://sportinox.com.br/produtos/"]')) {
                    if (a.href && !a.href.endsWith('/produtos/')) {
                        set.add(a.href);
                    }
                }
                return Array.from(set);
            }"""
        )

        target_links = links[:limit]
        for prod_url in target_links:
            try:
                resp = await page.goto(prod_url, wait_until="domcontentloaded", timeout=15000)
                if not resp or resp.status >= 400:
                    continue
                data = await page.evaluate(
                    """() => {
                        const html = document.documentElement.innerHTML;
                        const skuMatch = html.match(/"sku"\\s*:\\s*"([^"]+)"/);
                        const sku = skuMatch ? skuMatch[1] : null;
                        const imgs = [];
                        for (const el of document.querySelectorAll('a[data-fancybox="product-gallery"], .js-product-slide-img, .product-slider-image')) {
                            const u = el.getAttribute('href') || el.getAttribute('data-src') || el.getAttribute('src');
                            if (u) imgs.push(u);
                        }
                        if (imgs.length === 0) {
                            const matches = html.match(/\\/\\/acdn-us\\.mitiendanube\\.com\\/stores\\/006\\/154\\/873\\/products\\/[a-zA-Z0-9_-]+-1024-1024\\.webp/g) || [];
                            imgs.push(...matches);
                        }
                        return { sku, imgs };
                    }"""
                )
                sku_raw = str(data.get("sku") or "").strip()
                if not sku_raw:
                    continue
                sku_norm = normalize_code_strict(sku_raw)
                cleaned_urls: List[str] = []
                seen_ids: Set[str] = set()
                for u in data.get("imgs") or []:
                    parts = [p.strip().split(" ")[0] for p in str(u).split(",") if p.strip()]
                    cand = promote_cdn_url_to_full_hd(parts[-1] if parts else str(u))
                    if not is_valid_studio_image_url(cand):
                        continue
                    m = re.search(r"/products/([a-f0-9-]+)-\d+-\d+\.webp", cand)
                    k = m.group(1) if m else cand
                    if k not in seen_ids:
                        seen_ids.add(k)
                        cleaned_urls.append(cand)
                if cleaned_urls:
                    sku_to_urls[sku_norm] = cleaned_urls[:5]
            except Exception:
                continue
    finally:
        await page.close()

    return sku_to_urls


async def scrape_industriasportinox_line_page(
    semaphore: asyncio.Semaphore,
    context: BrowserContext,
    php_page: str,
    macro_line: str,
    default_automaker: str,
    max_items: int = 40,
) -> List[Dict[str, Any]]:
    """
    Extrai lançamentos e itens de Linha Pesada (Caminhões) e Linha Motos
    diretamente do portal http://www.industriasportinox.com/{php_page} via Playwright.
    """
    url = f"http://www.industriasportinox.com/{php_page}"
    async with semaphore:
        page = await context.new_page()
        try:
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            if not resp or resp.status >= 400:
                return []

            raw_cards: List[Dict[str, str]] = await page.evaluate(
                """(maxItems) => {
                    const cards = Array.from(document.querySelectorAll('div.produtos')).slice(0, maxItems);
                    return cards.map(c => {
                        const imgEl = c.querySelector('img');
                        const inputEl = c.querySelector('input[name="quantidade[]"]');
                        const redEl = c.querySelector('.red');
                        const textLines = (c.innerText || '')
                            .split('\\n')
                            .map(l => l.trim())
                            .filter(Boolean);
                        return {
                            imgSrc: imgEl ? imgEl.getAttribute('src') || '' : '',
                            inputVal: inputEl ? inputEl.getAttribute('value') || '' : '',
                            category: redEl ? redEl.textContent.trim() : '',
                            linesJson: JSON.stringify(textLines)
                        };
                    });
                }""",
                max_items,
            )

            discovered: List[Dict[str, Any]] = []
            for card in raw_cards:
                input_val = card.get("inputVal", "")
                sku_raw = input_val.split("-")[0].strip() if "-" in input_val else ""
                if not sku_raw:
                    continue
                sku_norm = normalize_code_strict(sku_raw)
                sku_lower = normalize_sku_lower(sku_raw)

                lines: List[str] = json.loads(card.get("linesJson", "[]"))
                category = card.get("category") or (lines[0] if lines else "EMBLEMA LINHA PESADA")
                subtitle = lines[1] if len(lines) > 1 else sku_raw
                automaker = lines[2] if len(lines) > 2 else default_automaker

                papel_idx = next((i for i, l in enumerate(lines) if l.lower().startswith("papel:")), -1)
                app_text = (
                    " ".join(lines[3:papel_idx]).strip()
                    if papel_idx > 3
                    else f"Linha {automaker.title()}"
                )

                substrate = "Cromado"
                resin_finish = "Resinado"
                color = "Padrão"
                dimensions_raw = "Padrão"
                package_qty = "1 un"

                for l in lines[max(0, papel_idx):]:
                    low = l.lower()
                    if low.startswith("papel:"):
                        substrate = l.split(":", 1)[1].strip() or "Cromado"
                    elif "resinado" in low or "sem resina" in low:
                        resin_finish = "Sem Resina" if "sem resina" in low else "Resinado"
                        m_cor = re.search(r"cor\s+(.+)$", l, flags=re.IGNORECASE)
                        if m_cor:
                            color = m_cor.group(1).strip()
                    elif " - " in l:
                        pts = [p.strip() for p in l.split(" - ") if p.strip()]
                        if len(pts) >= 2:
                            dimensions_raw, package_qty = pts[0], pts[1]

                img_src = card.get("imgSrc", "").strip()
                img_abs_url = urljoin(url, img_src) if img_src else ""

                year_start, year_end, is_ongoing = parse_year_range_from_text(f"{subtitle} {app_text}")
                automaker_line = resolve_automaker_line_label(default_automaker if default_automaker != "LANÇAMENTOS" else automaker)

                discovered.append({
                    "sku_raw": sku_raw,
                    "sku_norm": sku_norm,
                    "sku_lower": sku_lower,
                    "macro_line": macro_line,
                    "product_line": automaker_line,
                    "category": category.upper(),
                    "subtitle": subtitle,
                    "automaker": automaker.upper(),
                    "app_text": app_text,
                    "year_start": year_start,
                    "year_end": year_end,
                    "is_ongoing": is_ongoing,
                    "substrate": substrate,
                    "resin_finish": resin_finish,
                    "color": color,
                    "dimensions": dimensions_raw,
                    "package_qty": package_qty,
                    "img_url": img_abs_url,
                })

            return discovered
        except Exception as exc:
            print(f"[!] Aviso ao raspar {url}: {exc}")
            return []
        finally:
            await page.close()


async def download_and_convert_angles(
    semaphore: asyncio.Semaphore,
    context: BrowserContext,
    sku_raw: str,
    image_urls: List[str],
    existing_static_urls: List[str],
    use_lossless: bool,
) -> List[str]:
    """
    Baixa todas as URLs de ângulos de estúdio de um produto, converte cada uma
    via webp_studio_converter.py com nomenclatura 100% lowercase:
      - 1ª foto: /catalog-images/sportinox/{sku_lower}.webp
      - Ângulos extras: /catalog-images/sportinox/{sku_lower}_2.webp, _3.webp, _4.webp...
    Se o download falhar, preserva intacto o existing_static_urls (Fallback Defensivo Obrigatório).
    """
    sku_lower = normalize_sku_lower(sku_raw)
    SPORTINOX_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    async with semaphore:
        saved_urls: List[str] = []
        seen_hashes: Set[str] = set()

        # Se já existe a capa extraída do PDF XREF, registra seu hash para que ângulos extras sejam salvos como _2.webp, _3.webp
        cover_path = SPORTINOX_IMAGES_DIR / f"{sku_lower}.webp"
        if cover_path.exists() and audit_webp_image(cover_path)[0]:
            saved_urls.append(f"/catalog-images/sportinox/{sku_lower}.webp")

        for img_url in image_urls:
            if len(saved_urls) >= 5:
                break
            try:
                resp = await context.request.get(img_url, timeout=15000)
                if not resp.ok:
                    continue
                raw_bytes = await resp.body()
                if len(raw_bytes) < 500:
                    continue

                angle_index = len(saved_urls) + 1
                filename = (
                    f"{sku_lower}.webp"
                    if angle_index == 1
                    else f"{sku_lower}_{angle_index}.webp"
                )
                out_path = SPORTINOX_IMAGES_DIR / filename

                conv = convert_bytes_to_studio_webp(
                    raw_image_bytes=raw_bytes,
                    output_path=out_path,
                    max_dimension=1600,
                    padding=16,
                    clean_corners=True,
                    use_lossless=use_lossless,
                    quality=96,
                )
                if conv.success and conv.audit_passed:
                    if conv.sha256_hex in seen_hashes:
                        if angle_index > 1 and out_path.exists():
                            out_path.unlink(missing_ok=True)
                        continue
                    seen_hashes.add(conv.sha256_hex)
                    rel_url = f"/catalog-images/sportinox/{filename}".lower()
                    if rel_url not in saved_urls:
                        saved_urls.append(rel_url)
            except Exception:
                continue

        return saved_urls if saved_urls else existing_static_urls


async def async_main() -> None:
    parser = argparse.ArgumentParser(
        description="PASSO 3 — Super-Enriquecimento Web Multi-Ângulos Sportinox via Playwright"
    )
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--lossless", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    t0 = time.perf_counter()
    if not SEED_PATH.exists():
        print(f"[ERRO] Seed não encontrado em {SEED_PATH}. Execute extract_catalogs_xref.py primeiro.")
        sys.exit(1)

    seed_data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    products: List[Dict[str, Any]] = seed_data.get("products", [])
    by_sku_norm: Dict[str, Dict[str, Any]] = {
        p["commercialCodeNormalized"]: p for p in products
    }

    cache = load_scrape_cache()
    semaphore = asyncio.Semaphore(max(1, args.concurrency))

    print("==================================================================")
    print("[PLAYWRIGHT ENRICHER] Iniciando Super-Enriquecimento Multi-Ângulos Sportinox")
    print(f"   • Catálogo base: {len(products)} produtos | Concorrência: {args.concurrency}")
    print("==================================================================")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
        )

        # --------------------------------------------------------------------
        # ETAPA 1: Descobrir e incorporar Lançamentos, Linha Pesada e Linha Motos
        #          a partir de http://www.industriasportinox.com/
        # --------------------------------------------------------------------
        line_pages_to_scrape = [
            ("lancamentos.php", "Lançamentos", "LANÇAMENTOS", 44),
            ("ford_caminhoes.php", "Linha Pesada", "FORD CAMINHOES", 25),
            ("iveco.php", "Linha Pesada", "IVECO CAMINHOES", 25),
            ("mb_caminhoes.php", "Linha Pesada", "MERCEDES BENZ CAMINHOES", 25),
            ("scania_caminhoes.php", "Linha Pesada", "SCANIA CAMINHOES", 25),
            ("caminhao.php", "Linha Pesada", "UNIVERSAL CAMINHOES", 10),
            ("vw_caminhoes.php", "Linha Pesada", "VOLKSWAGEN CAMINHOES", 25),
            ("motos.php", "Linha Motos", "MOTOS", 35),
        ]

        print("[1/3] Extraindo Lançamentos, Linha Pesada (Caminhões) e Linha Motos na web...")
        line_tasks = [
            scrape_industriasportinox_line_page(
                semaphore, context, php, m_line, auto, limit
            )
            for php, m_line, auto, limit in line_pages_to_scrape
        ]
        line_results = await asyncio.gather(*line_tasks)

        new_web_products_added = 0
        web_img_tasks: List[Tuple[Dict[str, Any], List[str]]] = []

        for page_items in line_results:
            for item in page_items:
                sku_norm = item["sku_norm"]
                sku_lower = item["sku_lower"]
                if sku_norm in by_sku_norm:
                    # Produto já existe do PDF -> adiciona a linha extra (ex.: "Lançamentos" ou "Linha Pesada")
                    existing = by_sku_norm[sku_norm]
                    for pl in [item["macro_line"], item["product_line"]]:
                        if pl and pl not in existing["productLines"]:
                            existing["productLines"].append(pl)
                else:
                    # Novo item descoberto no catálogo web (Linha Pesada / Motos / Lançamentos)
                    full_name = f"{item['category']} {item['subtitle']}".strip()
                    desc = (
                        f"{full_name} — {item['automaker']} ({item['app_text']}) | "
                        f"Papel: {item['substrate']} | {item['resin_finish']} - Cor: {item['color']} | "
                        f"{item['dimensions']} - {item['package_qty']}"
                    )
                    new_prod: Dict[str, Any] = {
                        "id": f"sportinox-{sku_lower}",
                        "commercialCodeRaw": item["sku_raw"],
                        "commercialCodeNormalized": sku_norm,
                        "brandName": "Sportinox",
                        "macroLine": item["macro_line"],
                        "productLine": item["product_line"],
                        "productLines": list({item["macro_line"], item["product_line"]}),
                        "category": item["category"],
                        "subCategory": item["subtitle"],
                        "name": full_name,
                        "description": desc,
                        "automaker": item["automaker"],
                        "oemCodes": [
                            {
                                "rawCode": f"SPX-{sku_norm}",
                                "normalizedCode": f"SPX{sku_norm}",
                                "automaker": item["automaker"],
                            }
                        ],
                        "vehicleApplications": [
                            {
                                "automaker": item["automaker"],
                                "model": item["app_text"],
                                "yearStart": item["year_start"],
                                "yearEnd": item["year_end"],
                                "isOngoing": item["is_ongoing"],
                                "rawText": f"{item['automaker']} - {item['app_text']}",
                            }
                        ],
                        "specs": {
                            "substrate": item["substrate"],
                            "resinFinish": item["resin_finish"],
                            "color": item["color"],
                            "dimensions": item["dimensions"],
                            "packageQty": item["package_qty"],
                            "pressureKpa": None,
                            "nozzlesQty": None,
                            "hasSensorHole": None,
                            "voltage": None,
                        },
                        "staticImageUrls": [],
                        "relations": [],
                        "sourcePdf": "industriasportinox.com (Web)",
                        "sourcePage": 1,
                    }
                    products.append(new_prod)
                    by_sku_norm[sku_norm] = new_prod
                    new_web_products_added += 1
                    if item["img_url"]:
                        web_img_tasks.append((new_prod, [item["img_url"]]))

        print(f"   -> {new_web_products_added} novos produtos de Linha Pesada / Motos / Lançamentos incorporados!")

        # --------------------------------------------------------------------
        # ETAPA 2: Capturar Múltiplos Ângulos HD na Loja Oficial https://sportinox.com.br/
        # --------------------------------------------------------------------
        print("[2/3] Capturando galerias multi-ângulos HD em https://sportinox.com.br/ ...")
        store_multi_angles = await discover_multi_angle_products_from_store_home(context, limit=30)

        # Também consulta SKUs estratégicos diretamente via busca na loja oficial
        strategic_skus = ["ADS758", "PPF0076", "ADS320", "ADS593", "PROT358", "ADS043", "ADS847"]
        for s_sku in strategic_skus:
            if s_sku not in store_multi_angles and s_sku in by_sku_norm:
                page = await context.new_page()
                try:
                    urls = await extract_multi_angle_urls_from_sportinox_store(page, s_sku)
                    if urls:
                        store_multi_angles[s_sku] = urls
                finally:
                    await page.close()

        for sku_norm, angle_urls in store_multi_angles.items():
            if sku_norm in by_sku_norm:
                web_img_tasks.append((by_sku_norm[sku_norm], angle_urls))

        # --------------------------------------------------------------------
        # ETAPA 3: Download e Conversão Automática para .WebP Sem Perda Visual
        # --------------------------------------------------------------------
        print(f"[3/3] Processando e auditando {len(web_img_tasks)} lotes de imagens WebP HD...")
        dl_coroutines = [
            download_and_convert_angles(
                semaphore=semaphore,
                context=context,
                sku_raw=prod["commercialCodeRaw"],
                image_urls=urls,
                existing_static_urls=prod.get("staticImageUrls", []),
                use_lossless=args.lossless,
            )
            for prod, urls in web_img_tasks
        ]
        dl_results = await asyncio.gather(*dl_coroutines)

        for (prod, _), final_static_urls in zip(web_img_tasks, dl_results):
            if final_static_urls:
                prod["staticImageUrls"] = [u.lower() for u in final_static_urls]
                cache[f"sportinox::{normalize_sku_lower(prod['commercialCodeRaw'])}"] = prod["staticImageUrls"]

        save_scrape_cache(cache)
        await context.close()
        await browser.close()

    # Garante que 100% dos caminhos em staticImageUrls estão em lowercase e têm fallback válido
    multi_angle_count = 0
    total_static_photos = 0
    for prod in products:
        urls = [str(u).lower() for u in (prod.get("staticImageUrls") or [])]
        prod["staticImageUrls"] = urls
        if len(urls) > 1:
            multi_angle_count += 1
        total_static_photos += len(urls)

    # Recalcula vínculos incluindo Linha Pesada e Motos
    compute_seed_relationships(products)

    seed_data["products"] = products
    seed_data["availableProductLines"] = sorted(
        list({pl for p in products for pl in p.get("productLines", [])})
    )
    seed_data["availableCategories"] = sorted(
        list({p["category"] for p in products})
    )
    seed_data["availableAutomakers"] = sorted(
        list({p["automaker"] for p in products})
    )

    SEED_PATH.write_text(
        json.dumps(seed_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    elapsed = round(time.perf_counter() - t0, 2)
    print("\n==================================================================")
    print("[OK] SUPER-ENRIQUECIMENTO PLAYWRIGHT + WEBP CONCLUÍDO!")
    print(f"   • Total de produtos no seed enriquecido: {len(products)}")
    print(f"   • Novos produtos web (Linha Pesada / Motos / Lançamentos): {new_web_products_added}")
    print(f"   • Produtos com múltiplos ângulos (_2.webp, _3.webp+): {multi_angle_count}")
    print(f"   • Total de imagens .webp vinculadas (100% lowercase): {total_static_photos}")
    print(f"   • Tempo total: {elapsed}s")
    print("==================================================================")


if __name__ == "__main__":
    asyncio.run(async_main())
