#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/generate_app_icons.py
Gera ícones binários válidos (.png e .ico) de alta resolução para PWA e Tauri v2 Windows (.exe / .msi).
"""

from pathlib import Path
from PIL import Image, ImageDraw

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = PROJECT_ROOT / "public"
TAURI_ICONS_DIR = PROJECT_ROOT / "src-tauri" / "icons"


def build_brand_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (29, 78, 216, 255))  # #1D4ED8 Automotive Blue
    draw = ImageDraw.Draw(img)

    # Moldura interna industrial branca de alto contraste
    pad = max(2, size // 12)
    draw.rounded_rectangle(
        [pad, pad, size - pad - 1, size - pad - 1],
        radius=max(4, size // 6),
        outline=(255, 255, 255, 255),
        width=max(2, size // 24),
    )

    # Detalhe geométrico central representando emblema resinado automotivo
    inner = size // 4
    draw.ellipse(
        [inner, inner, size - inner, size - inner],
        fill=(255, 255, 255, 255),
    )
    core = int(size * 0.36)
    draw.ellipse(
        [core, core, size - core, size - core],
        fill=(15, 23, 42, 255),
    )
    return img


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    TAURI_ICONS_DIR.mkdir(parents=True, exist_ok=True)

    # PWA Icons
    build_brand_icon(192).save(PUBLIC_DIR / "icon-192.png", format="PNG")
    build_brand_icon(512).save(PUBLIC_DIR / "icon-512.png", format="PNG")

    # Tauri v2 Icons
    build_brand_icon(32).save(TAURI_ICONS_DIR / "32x32.png", format="PNG")
    build_brand_icon(128).save(TAURI_ICONS_DIR / "128x128.png", format="PNG")
    build_brand_icon(256).save(TAURI_ICONS_DIR / "128x128@2x.png", format="PNG")
    icon_512 = build_brand_icon(512)
    icon_512.save(TAURI_ICONS_DIR / "icon.png", format="PNG")

    # Windows .ICO multi-size válido
    icon_256 = build_brand_icon(256)
    icon_256.save(
        TAURI_ICONS_DIR / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("[OK] Ícones binários PWA (.png) e Windows Tauri v2 (.ico / .png) gerados com sucesso.")


if __name__ == "__main__":
    main()
