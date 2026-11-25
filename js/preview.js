/* ==========================================================================
   EZ-Print Live Preview, Sheet Renderer & Interactive Free Transform Engine
   Supports drag, 8-anchor resize (with rotated anchor pinning), and rotation
   across One Per Page, Custom Grid, and All on One Page modes.
   ========================================================================== */
(function (global) {
  'use strict';

  const { CSS_PX_PER_MM, formatUnitValue, clamp } = global.EZPrint.Constants;

  const HANDLES = [
    { id: 'nw', hx: -1, hy: -1, baseAngle: 315 },
    { id: 'n', hx: 0, hy: -1, baseAngle: 0 },
    { id: 'ne', hx: 1, hy: -1, baseAngle: 45 },
    { id: 'e', hx: 1, hy: 0, baseAngle: 90 },
    { id: 'se', hx: 1, hy: 1, baseAngle: 135 },
    { id: 's', hx: 0, hy: 1, baseAngle: 180 },
    { id: 'sw', hx: -1, hy: 1, baseAngle: 225 },
    { id: 'w', hx: -1, hy: 0, baseAngle: 270 }
  ];

  function cursorForAngle(deg) {
    const norm = ((deg % 180) + 180) % 180;
    if (norm < 22.5 || norm >= 157.5) return 'ns-resize';
    if (norm < 67.5) return 'nesw-resize';
    if (norm < 112.5) return 'ew-resize';
    return 'nwse-resize';
  }

  class PreviewRenderer {
    constructor(elements, store) {
      this.el = elements;
      this.store = store;
      this.lastPlan = null;
      this.lastState = null;
      this.currentScale = 1;
      this.resizeObserver = null;
      this.activeInteraction = null;
      this.onLiveTransformChange = null;

      this._initResizeObserver();
      this._initInteractionListeners();
    }

    _initResizeObserver() {
      if (typeof ResizeObserver === 'undefined' || !this.el.previewScroll) return;
      this.resizeObserver = new ResizeObserver(() => {
        if (this.lastPlan && this.lastState) {
          this.updateZoomScale(this.lastState, this.lastPlan);
        }
      });
      this.resizeObserver.observe(this.el.previewScroll);
    }

    _initInteractionListeners() {
      const container = this.el.sheetsContainer;
      if (!container) return;

      // Deselect when clicking outside a photo/handle on the preview canvas
      this.el.previewScroll.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (
          e.target.closest('.photo-node') ||
          e.target.closest('.tf-handle') ||
          e.target.closest('.tf-rotate-handle') ||
          e.target.closest('.tf-hud')
        ) {
          return;
        }
        if (this.store.getState().selectedImageId) {
          this.store.selectImage(null);
        }
      });

      // Start drag, resize, or rotate
      container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;

        // Ignore HUD buttons (handled via click)
        if (e.target.closest('.tf-hud')) return;

        const rotateHandle = e.target.closest('.tf-rotate-handle');
        if (rotateHandle) {
          e.preventDefault();
          e.stopPropagation();
          this._beginRotate(e, rotateHandle.dataset.imageId);
          return;
        }

        const resizeHandle = e.target.closest('.tf-handle');
        if (resizeHandle) {
          e.preventDefault();
          e.stopPropagation();
          this._beginResize(e, resizeHandle.dataset.imageId, resizeHandle.dataset.handle);
          return;
        }

        const photoNode = e.target.closest('.photo-node');
        if (photoNode) {
          e.preventDefault();
          e.stopPropagation();
          const imageId = photoNode.dataset.imageId;
          this._beginDrag(e, imageId);
        }
      });

      window.addEventListener('pointermove', (e) => {
        if (!this.activeInteraction) return;
        e.preventDefault();
        this._handlePointerMove(e);
      });

      window.addEventListener('pointerup', (e) => {
        if (!this.activeInteraction) return;
        this._finishInteraction(e);
      });

      window.addEventListener('pointercancel', (e) => {
        if (!this.activeInteraction) return;
        this._finishInteraction(e);
      });
    }

    _getItemContext(imageId) {
      if (!this.lastPlan || !this.lastPlan.itemsById) return null;
      return this.lastPlan.itemsById[imageId] || null;
    }

    _beginDrag(e, imageId) {
      const ctx = this._getItemContext(imageId);
      if (!ctx) return;

      const state = this.store.getState();
      const wasSelected = state.selectedImageId === imageId;
      this.store.bringImageForward(imageId, state.layoutMode, true);
      if (!wasSelected) {
        this.store.selectImage(imageId);
      }
      this._applyZIndexDom(imageId);

      const freshCtx = this._getItemContext(imageId) || ctx;
      const item = freshCtx.item;

      this.activeInteraction = {
        type: 'drag',
        imageId,
        sheetIndex: freshCtx.sheetIndex,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
        baseRect: { ...item.baseRect },
        startDxMm: item.dxMm,
        startDyMm: item.dyMm,
        widthMm: item.widthMm,
        heightMm: item.heightMm,
        angle: item.angle
      };

      document.body.classList.add('tf-interacting', 'tf-dragging');
    }

    _beginResize(e, imageId, handleId) {
      const ctx = this._getItemContext(imageId);
      if (!ctx) return;
      const handleDef = HANDLES.find((h) => h.id === handleId);
      if (!handleDef) return;

      const item = ctx.item;
      const rad = (item.angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // Fixed opposite anchor point in sheet printable-area mm coordinates
      const localAnchorX = -handleDef.hx * (item.widthMm / 2);
      const localAnchorY = -handleDef.hy * (item.heightMm / 2);
      const anchorX = item.cxMm + localAnchorX * cos - localAnchorY * sin;
      const anchorY = item.cyMm + localAnchorX * sin + localAnchorY * cos;

      this.activeInteraction = {
        type: 'resize',
        imageId,
        sheetIndex: ctx.sheetIndex,
        handle: handleDef,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
        baseRect: { ...item.baseRect },
        startW: item.widthMm,
        startH: item.heightMm,
        angle: item.angle,
        cos,
        sin,
        anchorX,
        anchorY
      };

      document.body.classList.add('tf-interacting');
    }

    _beginRotate(e, imageId) {
      const ctx = this._getItemContext(imageId);
      if (!ctx) return;

      const overlay = this.el.sheetsContainer.querySelector(
        `.transform-overlay[data-sheet-index="${ctx.sheetIndex}"]`
      );
      if (!overlay) return;

      const overlayRect = overlay.getBoundingClientRect();
      const pxPerMm = CSS_PX_PER_MM * this.currentScale;
      const marginMm = this.lastPlan.metrics.marginMm;
      const item = ctx.item;

      const centerScreenX = overlayRect.left + (marginMm + item.cxMm) * pxPerMm;
      const centerScreenY = overlayRect.top + (marginMm + item.cyMm) * pxPerMm;

      this.activeInteraction = {
        type: 'rotate',
        imageId,
        sheetIndex: ctx.sheetIndex,
        centerScreenX,
        centerScreenY,
        moved: false,
        baseRect: { ...item.baseRect },
        dxMm: item.dxMm,
        dyMm: item.dyMm,
        widthMm: item.widthMm,
        heightMm: item.heightMm,
        angle: item.angle
      };

      document.body.classList.add('tf-interacting', 'tf-rotating');
    }

    _handlePointerMove(e) {
      const act = this.activeInteraction;
      if (!act || !this.lastPlan || !this.lastState) return;

      const pxPerMm = CSS_PX_PER_MM * this.currentScale;
      const mode = this.lastState.layoutMode;

      if (act.type === 'drag') {
        const dxPx = e.clientX - act.startClientX;
        const dyPx = e.clientY - act.startClientY;
        if (!act.moved && Math.hypot(dxPx, dyPx) < 2) return;
        act.moved = true;

        const nextDxMm = Math.round((act.startDxMm + dxPx / pxPerMm) * 100) / 100;
        const nextDyMm = Math.round((act.startDyMm + dyPx / pxPerMm) * 100) / 100;

        this.store.setImageTransform(act.imageId, { xMm: nextDxMm, yMm: nextDyMm }, mode, true);
        this._updateLiveDom(act.imageId, {
          cxMm: act.baseRect.cx + nextDxMm,
          cyMm: act.baseRect.cy + nextDyMm,
          widthMm: act.widthMm,
          heightMm: act.heightMm,
          angle: act.angle,
          dxMm: nextDxMm,
          dyMm: nextDyMm,
          hasCustomSize: null
        });
      } else if (act.type === 'resize') {
        const dxMm = (e.clientX - act.startClientX) / pxPerMm;
        const dyMm = (e.clientY - act.startClientY) / pxPerMm;
        if (!act.moved && Math.hypot(e.clientX - act.startClientX, e.clientY - act.startClientY) < 1.5) {
          return;
        }
        act.moved = true;

        // Project pointer delta onto the rotated box's local axes
        const du = dxMm * act.cos + dyMm * act.sin;
        const dv = -dxMm * act.sin + dyMm * act.cos;

        const MIN_MM = 10;
        const { hx, hy } = act.handle;
        let newW = act.startW;
        let newH = act.startH;

        if (hx !== 0 && hy !== 0) {
          // Corner handle: proportional by default; hold Shift for free aspect ratio
          if (e.shiftKey) {
            newW = clamp(act.startW + hx * du, MIN_MM, 1200);
            newH = clamp(act.startH + hy * dv, MIN_MM, 1200);
          } else {
            const rawW = act.startW + hx * du;
            const rawH = act.startH + hy * dv;
            const ratioW = rawW / act.startW;
            const ratioH = rawH / act.startH;
            const minScale = Math.max(MIN_MM / act.startW, MIN_MM / act.startH);
            const maxScale = Math.min(1200 / act.startW, 1200 / act.startH);
            const chosen = Math.abs(du / act.startW) >= Math.abs(dv / act.startH) ? ratioW : ratioH;
            const scale = clamp(chosen, minScale, maxScale);
            newW = act.startW * scale;
            newH = act.startH * scale;
          }
        } else {
          // Edge midpoint handle: independent width or height resize
          if (hx !== 0) newW = clamp(act.startW + hx * du, MIN_MM, 1200);
          if (hy !== 0) newH = clamp(act.startH + hy * dv, MIN_MM, 1200);
        }

        newW = Math.round(newW * 100) / 100;
        newH = Math.round(newH * 100) / 100;

        // Recompute center keeping opposite anchor pinned
        const localCenterX = hx * (newW / 2);
        const localCenterY = hy * (newH / 2);
        const newCx = act.anchorX + localCenterX * act.cos - localCenterY * act.sin;
        const newCy = act.anchorY + localCenterX * act.sin + localCenterY * act.cos;

        const nextDxMm = Math.round((newCx - act.baseRect.cx) * 100) / 100;
        const nextDyMm = Math.round((newCy - act.baseRect.cy) * 100) / 100;

        this.store.setImageTransform(
          act.imageId,
          { xMm: nextDxMm, yMm: nextDyMm, widthMm: newW, heightMm: newH },
          mode,
          true
        );
        this._updateLiveDom(act.imageId, {
          cxMm: newCx,
          cyMm: newCy,
          widthMm: newW,
          heightMm: newH,
          angle: act.angle,
          dxMm: nextDxMm,
          dyMm: nextDyMm,
          hasCustomSize: true
        });
      } else if (act.type === 'rotate') {
        act.moved = true;
        const rad = Math.atan2(e.clientY - act.centerScreenY, e.clientX - act.centerScreenX);
        let deg = (rad * 180) / Math.PI + 90;
        while (deg > 180) deg -= 360;
        while (deg <= -180) deg += 360;

        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        } else {
          // Soft magnetic snap to 0°, ±90°, ±180° within 2.5°
          const snapTargets = [-180, -90, 0, 90, 180];
          for (const target of snapTargets) {
            if (Math.abs(deg - target) <= 2.5) {
              deg = target === -180 ? 180 : target;
              break;
            }
          }
        }

        deg = Math.round(deg * 10) / 10;
        if (Object.is(deg, -0)) deg = 0;

        this.store.setImageTransform(act.imageId, { angle: deg }, mode, true);
        this._updateLiveDom(act.imageId, {
          cxMm: act.baseRect.cx + act.dxMm,
          cyMm: act.baseRect.cy + act.dyMm,
          widthMm: act.widthMm,
          heightMm: act.heightMm,
          angle: deg,
          dxMm: act.dxMm,
          dyMm: act.dyMm,
          hasCustomSize: null
        });
      }
    }

    _finishInteraction() {
      const act = this.activeInteraction;
      this.activeInteraction = null;
      document.body.classList.remove('tf-interacting', 'tf-dragging', 'tf-rotating');

      if (act && act.moved) {
        this.store.notify('transform');
      }
    }

    _applyZIndexDom(imageId) {
      const t = this.store.getImageTransform(imageId);
      const node = this.el.sheetsContainer.querySelector(`.photo-node[data-image-id="${imageId}"]`);
      if (node) {
        node.style.zIndex = String(t.zIndex || 1);
      }
    }

    _updateLiveDom(imageId, live) {
      const leftMm = live.cxMm - live.widthMm / 2;
      const topMm = live.cyMm - live.heightMm / 2;

      // Update cached item in lastPlan so subsequent reads stay accurate
      const ctx = this._getItemContext(imageId);
      if (ctx) {
        ctx.item.cxMm = live.cxMm;
        ctx.item.cyMm = live.cyMm;
        ctx.item.leftMm = leftMm;
        ctx.item.topMm = topMm;
        ctx.item.widthMm = live.widthMm;
        ctx.item.heightMm = live.heightMm;
        ctx.item.angle = live.angle;
        ctx.item.dxMm = live.dxMm;
        ctx.item.dyMm = live.dyMm;
        ctx.item.isTransformed = true;
        if (live.hasCustomSize) {
          ctx.item.hasCustomSize = true;
          ctx.item.objectFit = ctx.item.objectFit === 'cover' ? 'cover' : 'fill';
        }
      }

      // 1. Update physical photo node directly (zero DOM rebuild, 60fps)
      const photoNode = this.el.sheetsContainer.querySelector(`.photo-node[data-image-id="${imageId}"]`);
      if (photoNode) {
        photoNode.style.setProperty('--item-left-mm', `${leftMm}mm`);
        photoNode.style.setProperty('--item-top-mm', `${topMm}mm`);
        photoNode.style.setProperty('--item-w-mm', `${live.widthMm}mm`);
        photoNode.style.setProperty('--item-h-mm', `${live.heightMm}mm`);
        photoNode.style.setProperty('--item-angle', `${live.angle}deg`);
        photoNode.classList.add('is-transformed');

        if (live.hasCustomSize && ctx) {
          const img = photoNode.querySelector('img');
          if (img) img.style.objectFit = ctx.item.objectFit;
        }
      }

      // 2. Update screen-space transform overlay & floating HUD directly
      const tfBox = this.el.sheetsContainer.querySelector(`.tf-box[data-image-id="${imageId}"]`);
      if (tfBox && this.lastPlan) {
        const pxPerMm = CSS_PX_PER_MM * this.currentScale;
        const marginMm = this.lastPlan.metrics.marginMm;
        tfBox.style.left = `${(marginMm + leftMm) * pxPerMm}px`;
        tfBox.style.top = `${(marginMm + topMm) * pxPerMm}px`;
        tfBox.style.width = `${live.widthMm * pxPerMm}px`;
        tfBox.style.height = `${live.heightMm * pxPerMm}px`;
        tfBox.style.transform = `rotate(${live.angle}deg)`;

        // Update dynamic handle cursors
        HANDLES.forEach((h) => {
          const handleEl = tfBox.querySelector(`.tf-handle[data-handle="${h.id}"]`);
          if (handleEl) {
            handleEl.style.cursor = cursorForAngle(h.baseAngle + live.angle);
          }
        });

        // Update floating HUD position & live readout
        const hud = tfBox.parentElement.querySelector(`.tf-hud[data-image-id="${imageId}"]`);
        if (hud) {
          this._positionHud(hud, marginMm + live.cxMm, marginMm + live.cyMm, live.widthMm, live.heightMm, live.angle, pxPerMm);
          const readout = hud.querySelector('.tf-hud-readout');
          if (readout) {
            const unit = this.lastState.unit;
            const wStr = formatUnitValue(live.widthMm, unit);
            const hStr = formatUnitValue(live.heightMm, unit);
            const angleStr = `${Math.round(live.angle)}°`;
            readout.textContent = `${wStr} × ${hStr} ${unit} · ${angleStr}`;
          }
        }
      }

      if (typeof this.onLiveTransformChange === 'function' && ctx) {
        this.onLiveTransformChange(ctx.item);
      }
    }

    _positionHud(hud, centerSheetXMm, centerSheetYMm, wMm, hMm, angleDeg, pxPerMm) {
      const rad = (angleDeg * Math.PI) / 180;
      const absCos = Math.abs(Math.cos(rad));
      const absSin = Math.abs(Math.sin(rad));
      const boundingHalfH = (wMm * absSin + hMm * absCos) / 2;

      const xPx = centerSheetXMm * pxPerMm;
      const yPx = (centerSheetYMm + boundingHalfH) * pxPerMm + 12;

      hud.style.left = `${xPx}px`;
      hud.style.top = `${yPx}px`;
    }

    /**
     * Keeps @page CSS rule strictly synced to the chosen physical paper dimensions.
     */
    syncPagePrintRule(metrics) {
      if (!this.el.dynamicPageStyle) return;
      const w = metrics.pageWidthMm.toFixed(2);
      const h = metrics.pageHeightMm.toFixed(2);
      this.el.dynamicPageStyle.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
    }

    computePreviewScale(state, metrics) {
      const sheetPxW = metrics.pageWidthMm * CSS_PX_PER_MM;
      const sheetPxH = metrics.pageHeightMm * CSS_PX_PER_MM;

      if (typeof state.preview.zoom === 'number') {
        return clamp(state.preview.zoom, 0.25, 2.0);
      }

      const container = this.el.previewScroll;
      const availW = Math.max(220, (container ? container.clientWidth : 800) - 72);
      const availH = Math.max(260, (container ? container.clientHeight : 700) - 104);

      if (state.preview.viewMode === 'grid') {
        const targetCols = availW > 860 ? 2 : 1;
        const colW = (availW - (targetCols - 1) * 28) / targetCols;
        const scaleW = colW / sheetPxW;
        const scaleH = (availH * 0.78) / sheetPxH;
        return clamp(Math.min(scaleW, scaleH), 0.22, 0.9);
      }

      const scaleW = availW / sheetPxW;
      const scaleH = availH / sheetPxH;
      return clamp(Math.min(scaleW, scaleH), 0.25, 1.15);
    }

    updateZoomScale(state, plan) {
      const { metrics } = plan;
      const scale = this.computePreviewScale(state, metrics);
      this.currentScale = scale;

      const scaledW = Math.round(metrics.pageWidthMm * CSS_PX_PER_MM * scale * 100) / 100;
      const scaledH = Math.round(metrics.pageHeightMm * CSS_PX_PER_MM * scale * 100) / 100;

      const container = this.el.sheetsContainer;
      container.style.setProperty('--preview-scale', String(scale));
      container.style.setProperty('--page-w-mm', `${metrics.pageWidthMm}mm`);
      container.style.setProperty('--page-h-mm', `${metrics.pageHeightMm}mm`);
      container.style.setProperty('--margin-mm', `${metrics.marginMm}mm`);

      const wraps = container.querySelectorAll('.sheet-stage-wrap');
      wraps.forEach((wrap) => {
        wrap.style.width = `${scaledW}px`;
        wrap.style.height = `${scaledH}px`;
      });

      const viewports = container.querySelectorAll('.sheet-viewport');
      viewports.forEach((vp) => {
        vp.style.width = `${scaledW}px`;
        vp.style.height = `${scaledH}px`;
      });

      this.renderSelectionOverlay(state, plan);

      if (this.el.zoomFitBtn) {
        const pct = Math.round(scale * 100);
        this.el.zoomFitBtn.textContent = state.preview.zoom === 'fit' ? `Fit (${pct}%)` : `${pct}%`;
      }
    }

    render(state, plan) {
      this.lastState = state;
      this.lastPlan = plan;
      this.syncPagePrintRule(plan.metrics);

      const hasImages = plan.sheets.length > 0;
      this.el.emptyState.hidden = hasImages;
      this.el.sheetsContainer.hidden = !hasImages;

      this.el.sheetsContainer.classList.toggle('show-guides', state.preview.showGuides);
      this.el.sheetsContainer.classList.toggle('grid-view', state.preview.viewMode === 'grid');

      if (!hasImages) {
        this.el.sheetsContainer.innerHTML = '';
        if (this.el.zoomFitBtn) {
          this.el.zoomFitBtn.textContent = 'Fit';
        }
        return;
      }

      const fragment = document.createDocumentFragment();
      const totalPages = plan.sheets.length;

      plan.sheets.forEach((sheetSpec, sheetIndex) => {
        const slot = document.createElement('div');
        slot.className = 'sheet-slot';
        slot.dataset.sheetIndex = String(sheetIndex);

        // Wrapper holds clipped .sheet-viewport + unclipped .transform-overlay
        const stageWrap = document.createElement('div');
        stageWrap.className = 'sheet-stage-wrap';

        const viewport = document.createElement('div');
        viewport.className = 'sheet-viewport';

        const sheet = document.createElement('div');
        sheet.className = 'print-sheet';
        if (state.output.printCutLines) {
          sheet.classList.add('cut-lines');
        }

        const content = document.createElement('div');
        content.className = 'sheet-content';

        // Clip untransformed overflowing Center-mode images to printable margins
        if (
          sheetSpec.mode === 'one-per-page' &&
          sheetSpec.sizing === 'center' &&
          sheetSpec.items[0] &&
          !sheetSpec.items[0].isTransformed
        ) {
          content.classList.add('clip-printable');
        }

        // Background grid guides & cut-lines for grid modes
        if (sheetSpec.mode === 'grid') {
          const guides = document.createElement('div');
          guides.className = 'grid-guides-layer';
          guides.style.setProperty('--grid-rows', String(sheetSpec.rows));
          guides.style.setProperty('--grid-cols', String(sheetSpec.cols));
          guides.style.setProperty('--grid-gap-mm', `${sheetSpec.gapMm}mm`);

          const totalCells = sheetSpec.rows * sheetSpec.cols;
          for (let i = 0; i < totalCells; i++) {
            const cell = document.createElement('div');
            cell.className = sheetSpec.images[i] ? 'grid-guide-cell has-image' : 'grid-guide-cell is-empty';
            guides.appendChild(cell);
          }
          content.appendChild(guides);
        } else if (sheetSpec.mode === 'per-page' && sheetSpec.slots) {
          const guides = document.createElement('div');
          guides.className = 'slot-guides-layer';

          sheetSpec.slots.forEach((slotRect, idx) => {
            const box = document.createElement('div');
            box.className = idx < sheetSpec.images.length ? 'slot-guide-box has-image' : 'slot-guide-box is-empty';
            box.style.left = `${slotRect.x}mm`;
            box.style.top = `${slotRect.y}mm`;
            box.style.width = `${slotRect.w}mm`;
            box.style.height = `${slotRect.h}mm`;
            guides.appendChild(box);
          });
          content.appendChild(guides);
        }

        // Unified physical photo items layer
        const itemsLayer = document.createElement('div');
        itemsLayer.className = 'sheet-items-layer';

        sheetSpec.items.forEach((item) => {
          const node = document.createElement('div');
          node.className = 'photo-node';
          if (item.image.id === state.selectedImageId) {
            node.classList.add('is-selected');
          }
          if (item.isTransformed) {
            node.classList.add('is-transformed');
          }
          if (sheetSpec.mode === 'one-per-page' && sheetSpec.sizing === 'freeform') {
            node.classList.add('is-freeform-box');
          }

          node.dataset.imageId = item.image.id;
          node.style.setProperty('--item-left-mm', `${item.leftMm}mm`);
          node.style.setProperty('--item-top-mm', `${item.topMm}mm`);
          node.style.setProperty('--item-w-mm', `${item.widthMm}mm`);
          node.style.setProperty('--item-h-mm', `${item.heightMm}mm`);
          node.style.setProperty('--item-angle', `${item.angle}deg`);
          node.style.zIndex = String(item.zIndex || 1);
          node.title = 'Click to free transform · Drag to move';

          const media = document.createElement('div');
          media.className = 'photo-media';

          const img = document.createElement('img');
          img.src = item.image.url;
          img.alt = item.image.name;
          img.draggable = false;
          img.decoding = 'async';
          img.style.objectFit = item.objectFit;

          media.appendChild(img);
          node.appendChild(media);

          if (state.output.showCaptions) {
            const cap = document.createElement('div');
            cap.className =
              sheetSpec.mode === 'one-per-page' ? 'print-caption caption-lg' : 'print-caption';
            cap.textContent = item.image.name;
            node.appendChild(cap);
          }

          itemsLayer.appendChild(node);
        });

        content.appendChild(itemsLayer);
        sheet.appendChild(content);
        viewport.appendChild(sheet);

        // Screen-only overlay for Free Transform handles (unclipped!)
        const overlay = document.createElement('div');
        overlay.className = 'transform-overlay';
        overlay.dataset.sheetIndex = String(sheetIndex);

        stageWrap.appendChild(viewport);
        stageWrap.appendChild(overlay);
        slot.appendChild(stageWrap);

        const meta = document.createElement('div');
        meta.className = 'sheet-meta';
        if (sheetSpec.mode === 'one-per-page') {
          meta.textContent = `Page ${sheetSpec.pageNumber} of ${totalPages} · ${sheetSpec.image.name}`;
        } else if (sheetSpec.mode === 'per-page') {
          const countLabel = `${sheetSpec.images.length} ${sheetSpec.images.length === 1 ? 'image' : 'images'}`;
          meta.textContent = `Page ${sheetSpec.pageNumber} of ${totalPages} · ${countLabel} (${sheetSpec.targetPerPage} per page)`;
        } else {
          meta.textContent = `Page ${sheetSpec.pageNumber} of ${totalPages} · ${sheetSpec.images.length} ${
            sheetSpec.images.length === 1 ? 'image' : 'images'
          } (${sheetSpec.rows}×${sheetSpec.cols})`;
        }
        slot.appendChild(meta);

        fragment.appendChild(slot);
      });

      this.el.sheetsContainer.innerHTML = '';
      this.el.sheetsContainer.appendChild(fragment);

      this.updateZoomScale(state, plan);
    }

    /**
     * Renders the screen-space Free Transform bounding box, 8 anchor points,
     * rotation knob, and floating HUD bar for the currently selected photo.
     */
    renderSelectionOverlay(state, plan) {
      this.lastState = state;
      this.lastPlan = plan;

      const overlays = this.el.sheetsContainer.querySelectorAll('.transform-overlay');
      overlays.forEach((ov) => {
        ov.innerHTML = '';
      });

      // Toggle selected class on photo nodes
      const nodes = this.el.sheetsContainer.querySelectorAll('.photo-node');
      nodes.forEach((n) => {
        n.classList.toggle('is-selected', n.dataset.imageId === state.selectedImageId);
      });

      const selectedId = state.selectedImageId;
      if (!selectedId || !plan.itemsById || !plan.itemsById[selectedId]) return;

      const { sheetIndex, item } = plan.itemsById[selectedId];
      const overlay = this.el.sheetsContainer.querySelector(
        `.transform-overlay[data-sheet-index="${sheetIndex}"]`
      );
      if (!overlay) return;

      const pxPerMm = CSS_PX_PER_MM * this.currentScale;
      const marginMm = plan.metrics.marginMm;

      const box = document.createElement('div');
      box.className = 'tf-box';
      box.dataset.imageId = selectedId;
      box.style.left = `${(marginMm + item.leftMm) * pxPerMm}px`;
      box.style.top = `${(marginMm + item.topMm) * pxPerMm}px`;
      box.style.width = `${item.widthMm * pxPerMm}px`;
      box.style.height = `${item.heightMm * pxPerMm}px`;
      box.style.transform = `rotate(${item.angle}deg)`;

      // Rotation stem & knob
      const rotStem = document.createElement('div');
      rotStem.className = 'tf-rotate-stem';
      box.appendChild(rotStem);

      const rotHandle = document.createElement('button');
      rotHandle.type = 'button';
      rotHandle.className = 'tf-rotate-handle';
      rotHandle.dataset.imageId = selectedId;
      rotHandle.title = 'Drag to rotate (hold Shift for 15° snap)';
      rotHandle.setAttribute('aria-label', 'Rotate photo');
      rotHandle.innerHTML =
        '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';
      box.appendChild(rotHandle);

      // 8 Anchor Point Handles
      HANDLES.forEach((h) => {
        const handle = document.createElement('div');
        handle.className = `tf-handle tf-handle-${h.id}`;
        handle.dataset.imageId = selectedId;
        handle.dataset.handle = h.id;
        handle.style.cursor = cursorForAngle(h.baseAngle + item.angle);
        handle.title =
          h.hx !== 0 && h.hy !== 0
            ? 'Drag to resize proportionally (hold Shift to stretch)'
            : 'Drag to adjust dimension';
        box.appendChild(handle);
      });

      overlay.appendChild(box);

      // Upright Floating HUD Pill below the selected photo
      const hud = document.createElement('div');
      hud.className = 'tf-hud';
      hud.dataset.imageId = selectedId;

      const unit = state.unit;
      const wStr = formatUnitValue(item.widthMm, unit);
      const hStr = formatUnitValue(item.heightMm, unit);
      const angleStr = `${Math.round(item.angle)}°`;

      hud.innerHTML = `
        <span class="tf-hud-readout">${wStr} × ${hStr} ${unit} · ${angleStr}</span>
        <span class="tf-hud-sep"></span>
        <button class="tf-hud-btn" data-tf-action="rotate90" type="button" title="Rotate 90° clockwise">90°</button>
        <button class="tf-hud-btn" data-tf-action="reset" type="button" title="Reset free transform" ${
          item.isTransformed ? '' : 'disabled'
        }>Reset</button>
        <button class="tf-hud-btn done" data-tf-action="done" type="button" title="Done (Esc)">Done</button>
      `;

      hud.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tf-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.tfAction;
        if (action === 'rotate90') {
          this.store.setImageTransform(selectedId, { angle: (item.angle || 0) + 90 });
        } else if (action === 'reset') {
          this.store.resetImageTransform(selectedId);
        } else if (action === 'done') {
          this.store.selectImage(null);
        }
      });

      this._positionHud(
        hud,
        marginMm + item.cxMm,
        marginMm + item.cyMm,
        item.widthMm,
        item.heightMm,
        item.angle,
        pxPerMm
      );
      overlay.appendChild(hud);
    }

    scrollToImage(imageId) {
      const node = this.el.sheetsContainer.querySelector(`.photo-node[data-image-id="${imageId}"]`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }

    getCurrentScale() {
      return this.currentScale;
    }
  }

  global.EZPrint = global.EZPrint || {};
  global.EZPrint.PreviewRenderer = PreviewRenderer;
})(window);
