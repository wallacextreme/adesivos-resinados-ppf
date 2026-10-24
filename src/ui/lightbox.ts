/**
 * src/ui/lightbox.ts
 * Lightbox Studio de Alta Nitidez com Zoom de 50% a 400%, Pan por Arrasto e Carrossel de Ângulos.
 */

import { escapeHtml } from '../domain/security';
import { renderSvgIcon } from './icons';
import type { GalleryImageEntry } from './image-gallery';

export class StudioLightbox {
  private containerEl: HTMLElement | null = null;
  private entries: GalleryImageEntry[] = [];
  private currentIndex = 0;
  private zoomPercent = 100;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private productTitle = '';
  private productSku = '';

  public open(
    entries: GalleryImageEntry[],
    startIndex = 0,
    productSku = '',
    productTitle = ''
  ): void {
    if (!entries.length || typeof document === 'undefined') return;
    this.entries = entries;
    this.currentIndex = Math.max(0, Math.min(entries.length - 1, startIndex));
    this.zoomPercent = 100;
    this.panX = 0;
    this.panY = 0;
    this.productSku = productSku;
    this.productTitle = productTitle;

    this.render();
  }

  public close(): void {
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
  }

  private setZoom(nextZoom: number): void {
    this.zoomPercent = Math.max(50, Math.min(400, nextZoom));
    if (this.zoomPercent <= 100) {
      this.panX = 0;
      this.panY = 0;
    }
    this.updateTransform();
  }

  private updateTransform(): void {
    if (!this.containerEl) return;
    const imgEl = this.containerEl.querySelector<HTMLElement>('[data-lightbox-img]');
    const zoomLabel = this.containerEl.querySelector<HTMLElement>('[data-lightbox-zoom-label]');
    if (imgEl) {
      const scale = this.zoomPercent / 100;
      imgEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    }
    if (zoomLabel) {
      zoomLabel.textContent = `${this.zoomPercent}%`;
    }
  }

  private render(): void {
    this.close();
    const current = this.entries[this.currentIndex]!;

    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col select-none';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="flex items-center justify-between px-6 py-3 bg-slate-900 border-b border-slate-800 text-slate-100">
        <div class="flex items-center gap-3">
          <span class="font-mono text-lg font-extrabold px-2.5 py-0.5 rounded bg-blue-700 text-white">
            ${escapeHtml(this.productSku)}
          </span>
          <span class="font-semibold text-sm text-slate-200 truncate max-w-xl">
            ${escapeHtml(this.productTitle)}
          </span>
          <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
            Ângulo ${this.currentIndex + 1} de ${this.entries.length}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" data-zoom-out class="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 flex items-center gap-1 text-xs font-medium cursor-pointer" title="Reduzir Zoom">
            ${renderSvgIcon('zoomOut', 'w-4 h-4')}
          </button>
          <span data-lightbox-zoom-label class="font-mono text-xs font-bold w-14 text-center text-slate-100">
            ${this.zoomPercent}%
          </span>
          <button type="button" data-zoom-in class="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 flex items-center gap-1 text-xs font-medium cursor-pointer" title="Ampliar até 400%">
            ${renderSvgIcon('zoomIn', 'w-4 h-4')}
          </button>
          <button type="button" data-zoom-400 class="px-2.5 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white text-xs font-mono font-bold cursor-pointer">
            400% HD
          </button>
          <button type="button" data-zoom-reset class="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer">
            100%
          </button>
          <button type="button" data-lightbox-close class="ml-3 p-1.5 rounded bg-red-600 hover:bg-red-500 text-white cursor-pointer" title="Fechar (Esc)">
            ${renderSvgIcon('x', 'w-5 h-5')}
          </button>
        </div>
      </div>

      <div data-lightbox-stage class="relative flex-1 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing">
        ${
          this.entries.length > 1
            ? `
          <button type="button" data-prev-angle class="absolute left-6 z-10 p-3 rounded-full bg-slate-900/80 hover:bg-blue-700 text-white border border-slate-700 cursor-pointer">
            ${renderSvgIcon('chevronLeft', 'w-6 h-6')}
          </button>
          <button type="button" data-next-angle class="absolute right-6 z-10 p-3 rounded-full bg-slate-900/80 hover:bg-blue-700 text-white border border-slate-700 cursor-pointer">
            ${renderSvgIcon('chevronRight', 'w-6 h-6')}
          </button>
        `
            : ''
        }
        <div class="bg-white p-6 rounded-xl shadow-2xl border border-slate-300 flex items-center justify-center">
          <img
            data-lightbox-img
            src="${escapeHtml(current.displayUrl)}"
            alt="${escapeHtml(this.productTitle)}"
            class="max-h-[72vh] max-w-[82vw] object-contain transition-transform duration-75"
            draggable="false"
          />
        </div>
      </div>

      ${
        this.entries.length > 1
          ? `
        <div class="flex items-center justify-center gap-3 py-3 bg-slate-900 border-t border-slate-800">
          ${this.entries
            .map(
              (entry, idx) => `
            <button
              type="button"
              data-angle-idx="${idx}"
              class="w-16 h-16 rounded-lg bg-white p-1 border-2 overflow-hidden cursor-pointer transition ${
                idx === this.currentIndex
                  ? 'border-blue-500 ring-2 ring-blue-500/50'
                  : 'border-slate-700 opacity-70 hover:opacity-100'
              }"
            >
              <img src="${escapeHtml(entry.thumbUrl)}" alt="Ângulo ${idx + 1}" class="w-full h-full object-contain" />
            </button>
          `
            )
            .join('')}
        </div>
      `
          : ''
      }
    `;

    document.body.appendChild(overlay);
    this.containerEl = overlay;

    overlay.querySelector('[data-lightbox-close]')?.addEventListener('click', () => this.close());
    overlay.querySelector('[data-zoom-in]')?.addEventListener('click', () => this.setZoom(this.zoomPercent + 50));
    overlay.querySelector('[data-zoom-out]')?.addEventListener('click', () => this.setZoom(this.zoomPercent - 50));
    overlay.querySelector('[data-zoom-400]')?.addEventListener('click', () => this.setZoom(400));
    overlay.querySelector('[data-zoom-reset]')?.addEventListener('click', () => this.setZoom(100));

    overlay.querySelector('[data-prev-angle]')?.addEventListener('click', () => {
      this.currentIndex = (this.currentIndex - 1 + this.entries.length) % this.entries.length;
      this.render();
    });
    overlay.querySelector('[data-next-angle]')?.addEventListener('click', () => {
      this.currentIndex = (this.currentIndex + 1) % this.entries.length;
      this.render();
    });

    overlay.querySelectorAll<HTMLElement>('[data-angle-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-angle-idx') || '0', 10);
        this.currentIndex = idx;
        this.render();
      });
    });

    const stage = overlay.querySelector<HTMLElement>('[data-lightbox-stage]');
    stage?.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const delta = ev.deltaY < 0 ? 25 : -25;
        this.setZoom(this.zoomPercent + delta);
      },
      { passive: false }
    );

    stage?.addEventListener('mousedown', (ev) => {
      if ((ev.target as HTMLElement).closest('button')) return;
      this.isDragging = true;
      this.dragStartX = ev.clientX - this.panX;
      this.dragStartY = ev.clientY - this.panY;
    });

    window.addEventListener('mousemove', (ev) => {
      if (!this.isDragging) return;
      this.panX = ev.clientX - this.dragStartX;
      this.panY = ev.clientY - this.dragStartY;
      this.updateTransform();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }
}
