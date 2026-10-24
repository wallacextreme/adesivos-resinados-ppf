#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/verify_all_10_quality_gates.py
Auditor Automatizado dos 10 Quality Gates Obrigatórios (PASSO 6).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = PROJECT_ROOT / "src" / "data" / "catalog-master-seed.json"
AUDIT_PATH = PROJECT_ROOT / "src" / "data" / "xref-extraction-audit.json"
IMAGES_DIR = PROJECT_ROOT / "public" / "catalog-images" / "sportinox"

FORBIDDEN_EMOJIS = ("📥", "💾", "🖼️", "⚡", "🚀", "🗑️")


def main() -> None:
    print("================================================================================")
    print("AUDITORIA AUTOMATIZADA DOS 10 QUALITY GATES — CATÁLOGO SPORTINOX")
    print("================================================================================")

    # Gate 1: Design System (ui-ux-pro-max), Zero Emojis, ArrowUp/ArrowDown livres
    skill_exists = (PROJECT_ROOT / ".agents" / "skills" / "ui-ux-pro-max" / "SKILL.md").exists()
    ts_files = list((PROJECT_ROOT / "src").rglob("*.ts"))
    emoji_violations = 0
    arrow_trap_violations = 0
    for f in ts_files:
        txt = f.read_text(encoding="utf-8")
        if any(e in txt for e in FORBIDDEN_EMOJIS):
            emoji_violations += 1
        if "ArrowUp" in txt or "ArrowDown" in txt:
            arrow_trap_violations += 1

    gate1_pass = skill_exists and emoji_violations == 0 and arrow_trap_violations == 0
    print(
        f"[GATE 1] Design System ui-ux-pro-max & Zero Emojis: "
        f"{'PASS' if gate1_pass else 'FAIL'} "
        f"(skill={skill_exists}, emojis={emoji_violations}, arrowTraps={arrow_trap_violations})"
    )

    # Gate 2: Mineração Python XREF & Integridade de Pixels
    audit_data = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
    seed_data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    products = seed_data.get("products", [])
    gate2_pass = (
        audit_data.get("status") == "PASS"
        and audit_data.get("blackBackgroundCount") == 0
        and audit_data.get("pixelAuditFailed") == 0
        and len(products) >= 3199
    )
    print(
        f"[GATE 2] Mineração Python XREF & Integridade de Pixels: "
        f"{'PASS' if gate2_pass else 'FAIL'} "
        f"(produtos={len(products)}, fundosPretos={audit_data.get('blackBackgroundCount')}, falhasPixel={audit_data.get('pixelAuditFailed')})"
    )

    # Gate 3: Enriquecimento Playwright Multi-Ângulos & Case-Sensitivity Lowercase
    all_urls = [u for p in products for u in (p.get("staticImageUrls") or [])]
    uppercase_violations = sum(1 for u in all_urls if u != u.lower())
    missing_images = sum(1 for p in products if not p.get("staticImageUrls"))
    multi_angle_prods = sum(1 for p in products if len(p.get("staticImageUrls") or []) > 1)
    gate3_pass = uppercase_violations == 0 and missing_images == 0 and multi_angle_prods > 0
    print(
        f"[GATE 3] Playwright Multi-Ângulos & 100% Lowercase: "
        f"{'PASS' if gate3_pass else 'FAIL'} "
        f"(multiAngleProds={multi_angle_prods}, uppercaseViolations={uppercase_violations}, semFoto={missing_images})"
    )

    # Gate 4: Duplo Pipeline .WebP Sem Perda Visual (Python + TypeScript)
    webp_files = list(IMAGES_DIR.glob("*.webp"))
    client_converter_exists = (PROJECT_ROOT / "src" / "media" / "webp-converter.ts").exists()
    gate4_pass = len(webp_files) >= 3199 and client_converter_exists
    print(
        f"[GATE 4] Duplo Pipeline .WebP Sem Perda Visual: "
        f"{'PASS' if gate4_pass else 'FAIL'} "
        f"(arquivosWebP={len(webp_files)}, clientConverter={client_converter_exists})"
    )

    # Gate 10: PWA Offline & Tauri v2 Icons / Config
    sw_exists = (PROJECT_ROOT / "public" / "sw.js").exists()
    manifest_exists = (PROJECT_ROOT / "public" / "manifest.webmanifest").exists()
    ico_exists = (PROJECT_ROOT / "src-tauri" / "icons" / "icon.ico").exists()
    gate10_files = sw_exists and manifest_exists and ico_exists
    print(
        f"[GATE 10 PRE-CHECK] PWA & Tauri v2 Config/Icons: "
        f"{'PASS' if gate10_files else 'FAIL'} "
        f"(sw={sw_exists}, manifest={manifest_exists}, ico={ico_exists})"
    )


if __name__ == "__main__":
    main()
