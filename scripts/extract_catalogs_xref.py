#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/extract_catalogs_xref.py
PASSO 2 — Mineração Binária dos PDFs em Python (PyMuPDF/fitz + Pillow/PIL)
- Filtro Matemático Anti-Ruído (blacklist_xrefs para xrefs em > 3 páginas ou < 45x45px).
- Os 3 Tratamentos de Imagem para Obter Fundo Branco Puro (#FFFFFF):
    Cenário A: Transparência Nativa SMask composta sobre canvas #FFFFFF.
    Cenário B: Costura de Imagens Fatiadas (Stitching) e conversão CMYK -> sRGB.
    Cenário C: Limpeza de Fundo Colorido de Tabela via Floodfill nos 4 cantos (thresh=25).
- Associação Espacial por Bounding Box (x0, y0, x1, y1) e Merge Aditivo Multi-Página.
- Conversão Automática Build-Time em .WebP Sem Perda Visual (scripts/webp_studio_converter.py).
- Auditoria Automática de Integridade de Pixels (0 fundos pretos e 100% cantos #FFFFFF).
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import fitz  # PyMuPDF
from PIL import Image, ImageDraw

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from webp_studio_converter import audit_webp_image, convert_bytes_to_studio_webp

DATA_DIR = PROJECT_ROOT / "src" / "data"
PUBLIC_IMAGES_DIR = PROJECT_ROOT / "public" / "catalog-images" / "sportinox"
SEED_OUTPUT_PATH = DATA_DIR / "catalog-master-seed.json"
AUDIT_REPORT_PATH = DATA_DIR / "xref-extraction-audit.json"


# ============================================================================
# NORMALIZADORES E PARSERS TÉCNICOS DETERMINÍSTICOS
# ============================================================================

def normalize_code_strict(raw: str) -> str:
    """Uppercase, sem pontuação ou espaços, preservando zeros à esquerda."""
    return re.sub(r"[^A-Z0-9]", "", raw.strip().upper())


def normalize_sku_lower(raw: str) -> str:
    """Estritamente lowercase para nomes de arquivo Linux/Firebase."""
    return re.sub(r"[^a-z0-9]", "", raw.strip().lower())


AUTOMAKER_LINE_LABELS: Dict[str, str] = {
    "ALFA ROMEO": "Linha Alfa Romeo",
    "AUDI": "Linha Audi",
    "BMW": "Linha BMW",
    "BYD": "Linha BYD",
    "CAOA CHERY": "Linha Caoa Chery",
    "CHERY": "Linha Caoa Chery",
    "CITROEN": "Linha Citroën",
    "CITROËN": "Linha Citroën",
    "DODGE": "Linha Dodge",
    "FERRARI": "Linha Ferrari",
    "FIAT": "Linha Fiat",
    "FORD": "Linha Ford",
    "FORD CAMINHOES": "Linha Ford Caminhões",
    "GM": "Linha Chevrolet (GM)",
    "CHEVROLET": "Linha Chevrolet (GM)",
    "GMC": "Linha GMC",
    "GURGEL": "Linha Gurgel",
    "HYUNDAI": "Linha Hyundai",
    "IVECO": "Linha Iveco Caminhões",
    "IVECO CAMINHOES": "Linha Iveco Caminhões",
    "JAC MOTORS": "Linha JAC Motors",
    "JEEP": "Linha Jeep",
    "KIA MOTORS": "Linha Kia Motors",
    "LAND ROVER": "Linha Land Rover",
    "MERCEDES BENZ": "Linha Mercedes-Benz",
    "MB CAMINHOES": "Linha MB Caminhões",
    "MERCEDES BENZ CAMINHOES": "Linha MB Caminhões",
    "MINI": "Linha Mini",
    "MITSUBISHI": "Linha Mitsubishi",
    "MOTOS": "Linha Motos",
    "NISSAN": "Linha Nissan",
    "PEUGEOT": "Linha Peugeot",
    "PORSCHE": "Linha Porsche",
    "RENAULT": "Linha Renault",
    "SCANIA": "Linha Scania Caminhões",
    "SCANIA CAMINHOES": "Linha Scania Caminhões",
    "TOYOTA": "Linha Toyota",
    "TROLLER": "Linha Troller",
    "UNIVERSAL": "Linha Universal",
    "UNIVERSAL CAMINHOES": "Linha Universal Caminhões",
    "VOLKSWAGEN": "Linha Volkswagen",
    "VW CAMINHOES": "Linha VW Caminhões",
    "VOLKSWAGEN CAMINHOES": "Linha VW Caminhões",
    "VOLVO": "Linha Volvo",
}


def resolve_automaker_line_label(automaker_raw: str) -> str:
    clean = automaker_raw.strip().upper()
    if clean in AUTOMAKER_LINE_LABELS:
        return AUTOMAKER_LINE_LABELS[clean]
    return f"Linha {automaker_raw.strip().title()}"


def _expand_2digit_year(y: int) -> int:
    if y >= 100:
        return y
    return 2000 + y if y <= 35 else 1900 + y


def parse_year_range_from_text(text: str) -> Tuple[Optional[int], Optional[int], bool]:
    """
    Parser determinístico de intervalos de anos em textos de aplicação:
    Suporta:
      - '1988/1994', '2022/2024', '97/99', '09/13' -> (1997, 1999, False)
      - '08/...', '13/', '>12', '2018 em diante' -> (2008, None, True)
      - '.../92', '/12', '/19', 'até 2012' -> (None, 2012, False)
      - '2025', '2014' -> (2025, 2025, False)
    """
    s = text.strip()

    # 1. Intervalo explícito: 97/99, 2009/2013, 08/...
    m_range = re.search(r"\b(\d{2}|\d{4})\s*/\s*(\.{2,3}|\d{2}|\d{4})\b", s)
    if m_range:
        y1_raw, y2_raw = m_range.group(1), m_range.group(2)
        # Evita confundir frações tipo 1/2 ou medidas
        y1 = _expand_2digit_year(int(y1_raw))
        if y2_raw.startswith("."):
            return y1, None, True
        y2 = _expand_2digit_year(int(y2_raw))
        if 1930 <= y1 <= 2035 and 1930 <= y2 <= 2035:
            return min(y1, y2), max(y1, y2), False

    # 2. Ano inicial em aberto: '13/', '06/', '>12'
    m_open_end = re.search(r"(?:^|\s|>)(\d{2}|\d{4})\s*/(?:\s|$|\.{2,3})", s)
    if m_open_end:
        y1 = _expand_2digit_year(int(m_open_end.group(1)))
        if 1950 <= y1 <= 2035:
            return y1, None, True

    m_gt = re.search(r">\s*(\d{2}|\d{4})\b", s)
    if m_gt:
        y1 = _expand_2digit_year(int(m_gt.group(1)))
        if 1950 <= y1 <= 2035:
            return y1, None, True

    # 3. Ano final até: '.../92', '/12', '/19'
    m_open_start = re.search(r"(?:\.{2,3}|^|\s)/\s*(\d{2}|\d{4})\b", s)
    if m_open_start:
        y2 = _expand_2digit_year(int(m_open_start.group(1)))
        if 1950 <= y2 <= 2035:
            return None, y2, False

    # 4. Ano único de 4 dígitos: '2025', '2014'
    m_single = re.search(r"\b(19\d{2}|20[0-3]\d)\b", s)
    if m_single:
        y = int(m_single.group(1))
        return y, y, False

    return None, None, False


def parse_dimensions_mm(dim_line: str) -> Optional[str]:
    """
    Extrai a medida da linha (ex.: '48 mm - 4 un' -> '48 mm', '75 x 14 cm - 1 un' -> '750 x 140 mm (75 x 14 cm)').
    """
    parts = [p.strip() for p in dim_line.split(" - ") if p.strip()]
    if not parts:
        return None
    raw_measure = parts[0]
    if "cm" in raw_measure.lower() or "mm" in raw_measure.lower():
        return raw_measure
    return raw_measure


# ============================================================================
# OS 3 TRATAMENTOS DE IMAGEM PARA OBTER FUNDO BRANCO PURO (#FFFFFF)
# ============================================================================

def extract_xref_image_with_treatments(
    doc: fitz.Document,
    xref: int,
    smask_xref: int = 0,
) -> Optional[Image.Image]:
    """
    Aplica rigorosamente os 3 Cenários de Tratamento de Imagem do Passo 2:
    - Cenário A: Transparência Nativa SMask composta sobre canvas #FFFFFF.
    - Cenário B: Conversão de CMYK para sRGB via fitz.Pixmap(fitz.csRGB, pix).
    - Cenário C: Limpeza de fundo colorido nos 4 cantos via ImageDraw.floodfill (thresh=25).
    """
    try:
        base_info = doc.extract_image(xref)
    except Exception:
        return None

    if not base_info or not base_info.get("image"):
        return None

    smask_xref_actual = smask_xref or int(base_info.get("smask") or 0)
    cs_name = str(base_info.get("cs-name") or "").upper()

    # Cenário B (parte 1): Se a imagem estiver em CMYK ou outro espaço não-RGB, converte via fitz.Pixmap(fitz.csRGB)
    raw_bytes = base_info["image"]
    try:
        if "CMYK" in cs_name or "DEVICECMYK" in cs_name:
            pix = fitz.Pixmap(doc, xref)
            rgb_pix = fitz.Pixmap(fitz.csRGB, pix)
            img = Image.open(io.BytesIO(rgb_pix.tobytes("png"))).convert("RGB")
        else:
            img = Image.open(io.BytesIO(raw_bytes))
            img.load()
            if img.mode == "CMYK":
                pix = fitz.Pixmap(doc, xref)
                rgb_pix = fitz.Pixmap(fitz.csRGB, pix)
                img = Image.open(io.BytesIO(rgb_pix.tobytes("png"))).convert("RGB")
    except Exception:
        try:
            pix = fitz.Pixmap(doc, xref)
            if pix.n - pix.alpha != 3:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
        except Exception:
            return None

    # Cenário A: Transparência Nativa SMask -> compor sobre canvas branco puro (255, 255, 255, 255)
    if smask_xref_actual > 0:
        try:
            smask_info = doc.extract_image(smask_xref_actual)
            if smask_info and smask_info.get("image"):
                mask_img = Image.open(io.BytesIO(smask_info["image"])).convert("L")
                rgb_base = img.convert(" RGBA") if img.mode == "RGBA" else img.convert("RGBA")
                if mask_img.size != rgb_base.size:
                    mask_img = mask_img.resize(rgb_base.size, Image.Resampling.LANCZOS)
                r, g, b, _ = rgb_base.split()
                rgba_with_mask = Image.merge("RGBA", (r, g, b, mask_img))
                white_canvas = Image.new("RGBA", rgb_base.size, (255, 255, 255, 255))
                img = Image.alpha_composite(white_canvas, rgba_with_mask).convert("RGB")
        except Exception:
            img = img.convert("RGB")
    elif img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        white_canvas = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        img = Image.alpha_composite(white_canvas, rgba).convert("RGB")
    else:
        img = img.convert("RGB")

    # Cenário C: Limpeza de Fundo Colorido de Tabela (Floodfill thresh=25 nos 4 cantos)
    w, h = img.size
    if w >= 10 and h >= 10:
        corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
        for cx, cy in corners:
            px = img.getpixel((cx, cy))
            if isinstance(px, tuple) and len(px) >= 3:
                r, g, b = px[0], px[1], px[2]
                is_white = r >= 250 and g >= 250 and b >= 250
                is_very_dark = r < 45 and g < 45 and b < 45
                if not is_white and not is_very_dark:
                    ImageDraw.floodfill(img, xy=(cx, cy), value=(255, 255, 255), thresh=25)

    return img


def stitch_vertical_slices_on_page(
    doc: fitz.Document,
    raw_placements: List[Dict[str, Any]],
    blacklist_xrefs: Set[int],
) -> List[Dict[str, Any]]:
    """
    Cenário B (parte 2): Costura de Imagens Fatiadas (Stitching).
    Une fatias verticais adjacentes da mesma peça quando abs(rectA.y1 - rectB.y0) < 2.0pt
    e possuem mesma coluna horizontal (abs(rectA.x0 - rectB.x0) < 2.0pt).
    """
    valid: List[Dict[str, Any]] = []
    for item in raw_placements:
        xref = item["xref"]
        if xref in blacklist_xrefs:
            continue
        if item["width"] < 45 or item["height"] < 45:
            continue
        valid.append(item)

    # Ordena por coluna (x0) e depois verticalmente (y0)
    valid.sort(key=lambda r: (round(r["bbox"][0], 1), round(r["bbox"][1], 1)))

    stitched: List[Dict[str, Any]] = []
    i = 0
    while i < len(valid):
        curr = dict(valid[i])
        slices_xrefs = [curr["xref"]]
        x0, y0, x1, y1 = curr["bbox"]

        while i + 1 < len(valid):
            nxt = valid[i + 1]
            nx0, ny0, nx1, ny1 = nxt["bbox"]
            same_col = abs(x0 - nx0) < 2.0 and abs(x1 - nx1) < 2.0
            vert_adj = abs(y1 - ny0) < 2.0
            if same_col and vert_adj:
                slices_xrefs.append(nxt["xref"])
                y1 = ny1
                i += 1
            else:
                break

        curr["bbox"] = (x0, y0, x1, y1)
        curr["slices_xrefs"] = slices_xrefs
        stitched.append(curr)
        i += 1

    return stitched


def build_pil_image_from_placement(
    doc: fitz.Document,
    placement: Dict[str, Any],
) -> Optional[Image.Image]:
    slices_xrefs: List[int] = placement.get("slices_xrefs") or [placement["xref"]]
    pil_slices: List[Image.Image] = []
    for x in slices_xrefs:
        im = extract_xref_image_with_treatments(doc, x)
        if im is not None:
            pil_slices.append(im)

    if not pil_slices:
        return None
    if len(pil_slices) == 1:
        return pil_slices[0]

    # Costura vertical de fatias (Stitching)
    max_w = max(im.width for im in pil_slices)
    total_h = sum(im.height for im in pil_slices)
    canvas = Image.new("RGB", (max_w, total_h), (255, 255, 255))
    curr_y = 0
    for im in pil_slices:
        canvas.paste(im, (0, curr_y))
        curr_y += im.height
    return canvas


# ============================================================================
# PARSER ESPACIAL DE BLOCOS DE PRODUTO E ASSOCIAÇÃO POR BOUNDING BOX
# ============================================================================

def parse_product_block_dict(
    block: Dict[str, Any],
    macro_line: str,
    source_pdf_name: str,
    page_number: int,
) -> Optional[Dict[str, Any]]:
    """
    Extrai de forma 100% determinística um bloco textual de produto usando
    informações tipográficas (cor vermelha 0xff0000 para Categoria, negrito para
    Subtítulo e SKU final, regular para Montadora/Linha, Aplicação e Especificações).
    """
    if block.get("type") != 0:
        return None

    lines_info: List[Tuple[str, bool, bool]] = []
    for line in block.get("lines", []):
        spans = line.get("spans", [])
        if not spans:
            continue
        txt = "".join(str(s.get("text", "")) for s in spans).replace("\xa0", " ").strip()
        if not txt:
            continue
        first_span = spans[0]
        is_red = int(first_span.get("color", 0)) == 0xFF0000
        is_bold = "bold" in str(first_span.get("font", "")).lower()
        lines_info.append((txt, is_red, is_bold))

    if len(lines_info) < 4:
        return None

    # 1. Linhas vermelhas no topo = Categoria exata
    cat_parts: List[str] = []
    idx = 0
    while idx < len(lines_info) and lines_info[idx][1]:
        cat_parts.append(lines_info[idx][0])
        idx += 1
    category = " ".join(cat_parts).strip() or "ADESIVO RESINADO"

    # 2. Linhas pretas em negrito logo abaixo = Subtítulo / Modelo da Peça
    title_parts: List[str] = []
    while idx < len(lines_info) and lines_info[idx][2] and not lines_info[idx][1]:
        if idx == len(lines_info) - 1:
            break
        title_parts.append(lines_info[idx][0])
        idx += 1
    subtitle = " ".join(title_parts).strip()

    # 3. Última linha do bloco = Código Comercial (SKU)
    sku_raw = lines_info[-1][0].strip()
    sku_norm = normalize_code_strict(sku_raw)
    if not sku_norm:
        return None

    # 4. Linhas intermediárias (Montadora, Aplicação, Papel, Resina/Cor, Medidas/Embalagem)
    mid_lines = [lines_info[i][0] for i in range(idx, len(lines_info) - 1)]

    papel_idx = next((i for i, m in enumerate(mid_lines) if m.lower().startswith("papel:")), -1)
    if papel_idx >= 1:
        automaker = mid_lines[0].strip()
        app_text = " ".join(mid_lines[1:papel_idx]).strip()
        spec_lines = mid_lines[papel_idx:]
    else:
        automaker = mid_lines[0].strip() if mid_lines else "UNIVERSAL"
        app_text = mid_lines[1].strip() if len(mid_lines) > 1 else "Todos os Veículos"
        spec_lines = mid_lines[2:] if len(mid_lines) > 2 else []

    if not app_text:
        app_text = f"Linha {automaker.title()}"

    # Parse das especificações técnicas (Papel, Resina, Cor, Medidas, Quantidade)
    substrate = "Cromado"
    resin_finish = "Resinado"
    color = "Padrão"
    dimensions_raw = ""
    package_qty = "1 un"

    for sline in spec_lines:
        low = sline.lower()
        if low.startswith("papel:"):
            substrate = sline.split(":", 1)[1].strip() or "Padrão"
        elif "resinado" in low or "sem resina" in low:
            if "sem resina" in low:
                resin_finish = "Sem Resina"
            else:
                resin_finish = "Resinado"
            if "cor" in low:
                m_cor = re.search(r"cor\s+(.+)$", sline, flags=re.IGNORECASE)
                if m_cor:
                    color = m_cor.group(1).strip()
        elif " - " in sline or any(u in low for u in ("mm", "cm", "un", "par", "kit", "jg")):
            parts = [p.strip() for p in sline.split(" - ") if p.strip()]
            if len(parts) >= 2:
                dimensions_raw = parts[0]
                package_qty = parts[1]
            elif len(parts) == 1:
                dimensions_raw = parts[0]

    year_start, year_end, is_ongoing = parse_year_range_from_text(f"{subtitle} {app_text}")
    automaker_line = resolve_automaker_line_label(automaker)

    full_name = f"{category} {subtitle}".strip()
    description = (
        f"{full_name} — {automaker} ({app_text}) | "
        f"Papel: {substrate} | {resin_finish} - Cor: {color} | "
        f"{dimensions_raw} - {package_qty}"
    ).strip(" |")

    return {
        "bbox": tuple(block["bbox"]),
        "commercialCodeRaw": sku_raw,
        "commercialCodeNormalized": sku_norm,
        "brandName": "Sportinox",
        "macroLine": macro_line,
        "productLine": automaker_line,
        "productLines": [macro_line, automaker_line],
        "category": category,
        "subCategory": subtitle,
        "name": full_name,
        "description": description,
        "automaker": automaker,
        "vehicleApplications": [
            {
                "automaker": automaker,
                "model": app_text,
                "yearStart": year_start,
                "yearEnd": year_end,
                "isOngoing": is_ongoing,
                "rawText": f"{automaker} - {app_text}",
            }
        ],
        "specs": {
            "substrate": substrate,
            "resinFinish": resin_finish,
            "color": color,
            "dimensions": parse_dimensions_mm(dimensions_raw) or dimensions_raw or "Padrão",
            "packageQty": package_qty,
            "pressureKpa": None,
            "nozzlesQty": None,
            "hasSensorHole": None,
            "voltage": None,
        },
        "sourcePdf": source_pdf_name,
        "sourcePage": page_number,
    }


def associate_images_to_products_on_page(
    stitched_images: List[Dict[str, Any]],
    parsed_products: List[Dict[str, Any]],
) -> Dict[int, Dict[str, Any]]:
    """
    Associa cada card de produto (texto) à sua imagem correspondente na página
    usando distância espacial entre os Bounding Boxes (x0, y0, x1, y1).
    No layout de grade da Sportinox, a imagem fica imediatamente acima do bloco de texto
    (mesma coluna x0 e img.y1 <= text.y0 + 15pt).
    """
    associations: Dict[int, Dict[str, Any]] = {}
    used_img_indices: Set[int] = set()

    for prod_idx, prod in enumerate(parsed_products):
        tx0, ty0, tx1, ty1 = prod["bbox"]
        tx_center = (tx0 + tx1) / 2.0

        best_img_idx: Optional[int] = None
        best_score = float("inf")

        for img_idx, img_item in enumerate(stitched_images):
            if img_idx in used_img_indices:
                continue
            ix0, iy0, ix1, iy1 = img_item["bbox"]
            ix_center = (ix0 + ix1) / 2.0

            dx = abs(tx_center - ix_center)
            # A base da imagem (iy1) fica logo acima do topo do texto (ty0)
            dy = abs(ty0 - iy1)

            if dx < 65.0 and dy < 60.0:
                score = dx * 1.5 + dy
                if score < best_score:
                    best_score = score
                    best_img_idx = img_idx

        # Fallback: imagem mais próxima na página se alguma célula tiver deslocamento atípico
        if best_img_idx is None and stitched_images:
            for img_idx, img_item in enumerate(stitched_images):
                ix0, iy0, ix1, iy1 = img_item["bbox"]
                dx = abs(tx0 - ix0)
                dy = abs(ty0 - iy1)
                score = dx + dy
                if score < best_score:
                    best_score = score
                    best_img_idx = img_idx

        if best_img_idx is not None:
            used_img_indices.add(best_img_idx)
            associations[prod_idx] = stitched_images[best_img_idx]

    return associations


# ============================================================================
# MOTOR DE GERAÇÃO AUTOMÁTICA DOS 4 TIPOS DE VÍNCULOS NO SEED
# ============================================================================

def compute_seed_relationships(products: List[Dict[str, Any]]) -> None:
    """
    Popula os vínculos iniciais entre os produtos do catálogo para enriquecer
    imediatamente as 4 Naturezas de Vínculos:
      1. VARIANTE_PRODUTO: Mesma categoria + mesmo subtítulo/aplicação com cor/medida/acabamento diferente.
      2. COMPOSICAO_KIT: Kits ('KIT...' ou '1 kit') vinculados às peças individuais da mesma linha/veículo.
      3. COMPATIBILIDADE_ACOPLAMENTO: Peças complementares do mesmo veículo (ex.: Soleira + Protetor de Maçaneta + Emblema de Calota).
      4. EQUIVALENCIA_DIRETA: Códigos de referência cruzada / OEM equivalentes na mesma categoria.
    """
    by_family: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    by_vehicle: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for p in products:
        cat = p["category"]
        automaker = p["automaker"]
        sub = re.sub(r"\b(PRETO|CROMADO|VERMELHO|AZUL|PRATA|DOURADO|BRANCO|FOSCO|BRILHANTE)\b", "", p["subCategory"]).strip()
        family_key = f"{cat}::{automaker}::{sub}"
        by_family[family_key].append(p)

        model_key = f"{automaker}::{p['vehicleApplications'][0]['model']}"
        by_vehicle[model_key].append(p)

    for p in products:
        sku = p["commercialCodeNormalized"]
        cat = p["category"]
        automaker = p["automaker"]
        sub = re.sub(r"\b(PRETO|CROMADO|VERMELHO|AZUL|PRATA|DOURADO|BRANCO|FOSCO|BRILHANTE)\b", "", p["subCategory"]).strip()
        family_key = f"{cat}::{automaker}::{sub}"
        model_key = f"{automaker}::{p['vehicleApplications'][0]['model']}"

        relations: List[Dict[str, Any]] = []
        seen_targets: Set[str] = {sku}

        # 1. VARIANTE_PRODUTO (variações de cor, diâmetro 48mm/51mm/58mm ou acabamento Resinado/Sem Resina)
        for Sib in by_family.get(family_key, []):
            t_sku = Sib["commercialCodeNormalized"]
            if t_sku not in seen_targets and len(relations) < 6:
                seen_targets.add(t_sku)
                relations.append({
                    "targetCodeNormalized": t_sku,
                    "targetBrand": Sib["brandName"],
                    "relationType": "VARIANTE_PRODUTO",
                    "note": f"Variante: {Sib['specs']['color']} / {Sib['specs']['dimensions']} ({Sib['specs']['resinFinish']})",
                })

        # 2. COMPOSICAO_KIT & 3. COMPATIBILIDADE_ACOPLAMENTO no mesmo veículo
        is_kit = sku.startswith("KIT") or "kit" in str(p["specs"].get("packageQty", "")).lower()
        comp_count = 0
        kit_count = 0
        for v_peer in by_vehicle.get(model_key, []):
            t_sku = v_peer["commercialCodeNormalized"]
            if t_sku in seen_targets:
                continue
            peer_cat = v_peer["category"]
            peer_is_kit = t_sku.startswith("KIT") or "kit" in str(v_peer["specs"].get("packageQty", "")).lower()

            if (is_kit and not peer_is_kit) or (not is_kit and peer_is_kit):
                if kit_count < 3:
                    seen_targets.add(t_sku)
                    kit_count += 1
                    relations.append({
                        "targetCodeNormalized": t_sku,
                        "targetBrand": v_peer["brandName"],
                        "relationType": "COMPOSICAO_KIT",
                        "note": f"Kit / Componente relacionado para {v_peer['vehicleApplications'][0]['model']}",
                    })
            elif peer_cat != cat and comp_count < 4:
                seen_targets.add(t_sku)
                comp_count += 1
                relations.append({
                    "targetCodeNormalized": t_sku,
                    "targetBrand": v_peer["brandName"],
                    "relationType": "COMPATIBILIDADE_ACOPLAMENTO",
                    "note": f"Aplicação complementar no veículo ({peer_cat})",
                })

        p["relations"] = relations


# ============================================================================
# PIPELINE PRINCIPAL DE MINERAÇÃO XREF + CONVERSÃO WEBP STUDIO
# ============================================================================

def run_extraction_pipeline() -> None:
    t0 = time.perf_counter()
    pdf_files = [
        (PROJECT_ROOT / "sportinox_linha_leve.pdf", "Linha Leve"),
        (PROJECT_ROOT / "sportinox_universal.pdf", "Linha Universal"),
    ]

    PUBLIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    merged_products: Dict[str, Dict[str, Any]] = {}
    xref_webp_cache: Dict[Tuple[str, Tuple[int, ...]], str] = {}

    total_pages_processed = 0
    total_blocks_parsed = 0
    total_blacklisted_xrefs = 0
    total_images_converted = 0
    total_audit_passed = 0
    black_bg_failures = 0

    for pdf_path, macro_line in pdf_files:
        if not pdf_path.exists():
            print(f"[!] Arquivo PDF não encontrado: {pdf_path}")
            continue

        doc = fitz.open(str(pdf_path))
        num_pages = len(doc)
        print(f"==================================================================")
        print(f"[PDF XREF MINER] Processando {pdf_path.name} ({num_pages} páginas | {macro_line})")
        print(f"==================================================================")

        # 1. Filtro Matemático Anti-Ruído (xrefs em > 3 páginas ou < 45x45px)
        xref_page_freq: Counter[int] = Counter()
        small_xrefs: Set[int] = set()

        for pno in range(num_pages):
            page = doc[pno]
            infos = page.get_image_info(xrefs=True)
            page_seen: Set[int] = set()
            for info in infos:
                x = int(info.get("xref") or 0)
                w = int(info.get("width") or 0)
                h = int(info.get("height") or 0)
                if x <= 0:
                    continue
                if w < 45 or h < 45:
                    small_xrefs.add(x)
                page_seen.add(x)
            for x in page_seen:
                xref_page_freq[x] += 1

        blacklist_xrefs: Set[int] = {
            x for x, freq in xref_page_freq.items() if freq > 3
        } | small_xrefs
        total_blacklisted_xrefs += len(blacklist_xrefs)

        # 2. Varredura página a página: Extração de Blocos, Costura e Associação Espacial
        for pno in range(num_pages):
            total_pages_processed += 1
            page = doc[pno]
            page_dict = page.get_text("dict")
            raw_img_infos = page.get_image_info(xrefs=True)

            stitched_imgs = stitch_vertical_slices_on_page(
                doc, raw_img_infos, blacklist_xrefs
            )

            page_products: List[Dict[str, Any]] = []
            for block in page_dict.get("blocks", []):
                parsed = parse_product_block_dict(
                    block, macro_line, pdf_path.name, pno + 1
                )
                if parsed is not None:
                    page_products.append(parsed)
                    total_blocks_parsed += 1

            associations = associate_images_to_products_on_page(
                stitched_imgs, page_products
            )

            for prod_idx, prod in enumerate(page_products):
                sku_norm = prod["commercialCodeNormalized"]
                sku_lower = normalize_sku_lower(prod["commercialCodeRaw"])
                out_webp_path = PUBLIC_IMAGES_DIR / f"{sku_lower}.webp"
                static_url = f"/catalog-images/sportinox/{sku_lower}.webp"

                img_placement = associations.get(prod_idx)
                if img_placement is not None:
                    slices_key = (
                        pdf_path.name,
                        tuple(img_placement.get("slices_xrefs") or [img_placement["xref"]]),
                    )
                    # Se o arquivo WebP deste SKU ainda não foi gerado ou precisa re-auditoria, processa
                    already_valid = out_webp_path.exists() and audit_webp_image(out_webp_path)[0]
                    if not already_valid:
                        if slices_key in xref_webp_cache and Path(xref_webp_cache[slices_key]).exists() and audit_webp_image(Path(xref_webp_cache[slices_key]))[0]:
                            # Reutiliza os bytes WebP já convertidos e auditados para o mesmo XREF
                            out_webp_path.write_bytes(Path(xref_webp_cache[slices_key]).read_bytes())
                            total_images_converted += 1
                            total_audit_passed += 1
                        else:
                            pil_img = build_pil_image_from_placement(doc, img_placement)
                            if pil_img is not None:
                                raw_buf = io.BytesIO()
                                pil_img.save(raw_buf, format="PNG")
                                is_tech_diagram = sku_norm.startswith("PPF")
                                conv = convert_bytes_to_studio_webp(
                                    raw_image_bytes=raw_buf.getvalue(),
                                    output_path=out_webp_path,
                                    max_dimension=1600,
                                    padding=16,
                                    clean_corners=True,
                                    use_lossless=is_tech_diagram,
                                    quality=96,
                                )
                                if conv.success and conv.audit_passed:
                                    xref_webp_cache[slices_key] = str(out_webp_path)
                                    total_images_converted += 1
                                    total_audit_passed += 1
                                else:
                                    if "Fundo preto" in conv.audit_message:
                                        black_bg_failures += 1
                    else:
                        total_images_converted += 1
                        total_audit_passed += 1

                # Merge Aditivo (Union) se o mesmo SKU aparecer em mais de uma página/PDF
                if sku_norm in merged_products:
                    existing = merged_products[sku_norm]
                    # Union de linhas
                    for pl in prod["productLines"]:
                        if pl not in existing["productLines"]:
                            existing["productLines"].append(pl)
                    # Union de aplicações veiculares
                    existing_apps_raw = {a["rawText"] for a in existing["vehicleApplications"]}
                    for app in prod["vehicleApplications"]:
                        if app["rawText"] not in existing_apps_raw:
                            existing["vehicleApplications"].append(app)
                            existing_apps_raw.add(app["rawText"])
                    # Union de imagens estáticas
                    if out_webp_path.exists() and static_url not in existing["staticImageUrls"]:
                        existing["staticImageUrls"].append(static_url)
                else:
                    prod_record = {
                        "id": f"sportinox-{sku_lower}",
                        "commercialCodeRaw": prod["commercialCodeRaw"],
                        "commercialCodeNormalized": sku_norm,
                        "brandName": "Sportinox",
                        "macroLine": prod["macroLine"],
                        "productLine": prod["productLine"],
                        "productLines": prod["productLines"],
                        "category": prod["category"],
                        "subCategory": prod["subCategory"],
                        "name": prod["name"],
                        "description": prod["description"],
                        "automaker": prod["automaker"],
                        "oemCodes": [
                            {
                                "rawCode": f"SPX-{sku_norm}",
                                "normalizedCode": f"SPX{sku_norm}",
                                "automaker": prod["automaker"],
                            }
                        ],
                        "vehicleApplications": prod["vehicleApplications"],
                        "specs": prod["specs"],
                        "staticImageUrls": [static_url] if out_webp_path.exists() else [],
                        "relations": [],
                        "sourcePdf": prod["sourcePdf"],
                        "sourcePage": prod["sourcePage"],
                    }
                    merged_products[sku_norm] = prod_record

            if (pno + 1) % 25 == 0 or (pno + 1) == num_pages:
                print(
                    f"  -> Página {pno + 1}/{num_pages} concluída "
                    f"(Produtos únicos acumulados: {len(merged_products)})"
                )

        doc.close()

    products_list = list(merged_products.values())
    print(f"[*] Calculando os 4 tipos de vínculos para {len(products_list)} produtos...")
    compute_seed_relationships(products_list)

    # Auditoria final de pixels sobre os arquivos .webp gerados
    webp_files = list(PUBLIC_IMAGES_DIR.glob("*.webp"))
    audited_ok = 0
    audited_fail = 0
    for wf in webp_files:
        ok, msg = audit_webp_image(wf)
        if ok:
            audited_ok += 1
        else:
            audited_fail += 1
            print(f"[!] Falha na auditoria de {wf.name}: {msg}")

    seed_payload = {
        "schemaVersion": 4,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "catalogTitle": "Catálogo Eletrônico Sportinox — Adesivos Resinados, Emblemas, Faixas e PPF",
        "referenceDocuments": [
            {
                "brandName": "Sportinox",
                "fileName": "sportinox_linha_leve.pdf",
                "macroLine": "Linha Leve",
                "pages": 148,
                "websiteUrl": "https://sportinox.com.br",
                "catalogUrl": "http://www.industriasportinox.com/index.html",
            },
            {
                "brandName": "Sportinox",
                "fileName": "sportinox_universal.pdf",
                "macroLine": "Linha Universal",
                "pages": 13,
                "websiteUrl": "https://sportinox.com.br",
                "catalogUrl": "http://www.industriasportinox.com/index.html",
            },
        ],
        "availableMacroLines": [
            "Linha Leve",
            "Linha Universal",
            "Linha Pesada",
            "Linha Motos",
            "Lançamentos",
        ],
        "availableProductLines": sorted(
            list({pl for p in products_list for pl in p.get("productLines", [])})
        ),
        "availableCategories": sorted(
            list({p["category"] for p in products_list})
        ),
        "availableAutomakers": sorted(
            list({p["automaker"] for p in products_list})
        ),
        "products": products_list,
    }

    SEED_OUTPUT_PATH.write_text(
        json.dumps(seed_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    elapsed = round(time.perf_counter() - t0, 2)
    audit_summary = {
        "status": "PASS" if audited_fail == 0 and black_bg_failures == 0 else "FAIL",
        "elapsedSeconds": elapsed,
        "totalPagesProcessed": total_pages_processed,
        "totalBlocksParsed": total_blocks_parsed,
        "uniqueProductsExtracted": len(products_list),
        "blacklistedNoiseXrefs": total_blacklisted_xrefs,
        "totalWebpImagesGenerated": len(webp_files),
        "pixelAuditPassed": audited_ok,
        "pixelAuditFailed": audited_fail,
        "blackBackgroundCount": black_bg_failures,
        "extractedDomains": [
            "https://sportinox.com.br",
            "http://www.industriasportinox.com/index.html",
        ],
    }
    AUDIT_REPORT_PATH.write_text(
        json.dumps(audit_summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("\n==================================================================")
    print("✅ MINERAÇÃO BINÁRIA XREF + WEBP STUDIO CONCLUÍDA COM SUCESSO!")
    print(f"   • Páginas processadas: {total_pages_processed}")
    print(f"   • Blocos de produtos minerados: {total_blocks_parsed}")
    print(f"   • Produtos únicos (após Merge Aditivo): {len(products_list)}")
    print(f"   • Imagens .webp geradas e auditadas: {audited_ok}/{len(webp_files)}")
    print(f"   • Imagens com fundo preto (SMask falha): {black_bg_failures}")
    print(f"   • Tempo total: {elapsed}s")
    print("==================================================================")


if __name__ == "__main__":
    run_extraction_pipeline()
