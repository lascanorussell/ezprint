/* ==========================================================================
   EZ-Print UI Controller
   Binds controls, drag-and-drop upload & reordering, clipboard paste, printing.
   ========================================================================== */
(function (global) {
  'use strict';

  const { mmToUnit, unitToMm, formatUnitValue, formatDimensions, clamp } = global.EZPrint.Constants;
  const { computeLayoutPlan } = global.EZPrint.Layout;

  class UIController {
    constructor(store, preview) {
      this.store = store;
      this.preview = preview;
      this.draggedImageId = null;
      this.fileDragDepth = 0;

      this.el = this._cacheElements();
      this._bindEvents();
      this.preview.onLiveTransformChange = (item) => this._syncSelectedTransformFields(item);
      this.store.subscribe((state, reason) => this.syncAll(state, reason));
      this.syncAll(this.store.getState(), 'init');
    }

    _cacheElements() {
      const byId = (id) => document.getElementById(id);
      return {
        fileInput: byId('fileInput'),
        headerSummary: byId('headerSummary'),
        headerAddBtn: byId('headerAddBtn'),
        printBtn: byId('printBtn'),
        printPageBadge: byId('printPageBadge'),
        modeTabs: Array.from(document.querySelectorAll('.mode-tab')),

        // Mobile drawers
        sidebarPanel: byId('sidebarPanel'),
        inspectorPanel: byId('inspectorPanel'),
        drawerBackdrop: byId('drawerBackdrop'),
        toggleSidebarBtn: byId('toggleSidebarBtn'),
        toggleInspectorBtn: byId('toggleInspectorBtn'),
        closeSidebarBtn: byId('closeSidebarBtn'),
        closeInspectorBtn: byId('closeInspectorBtn'),
        mobileImageCount: byId('mobileImageCount'),

        // Sidebar image queue
        imageCountPill: byId('imageCountPill'),
        reverseOrderBtn: byId('reverseOrderBtn'),
        clearAllBtn: byId('clearAllBtn'),
        sidebarDropzone: byId('sidebarDropzone'),
        sidebarEmpty: byId('sidebarEmpty'),
        sidebarSampleBtn: byId('sidebarSampleBtn'),
        imageList: byId('imageList'),

        // Empty state
        emptyDropzone: byId('emptyDropzone'),
        emptyBrowseBtn: byId('emptyBrowseBtn'),
        emptySampleBtn: byId('emptySampleBtn'),

        // Preview toolbar
        paperSpecChip: byId('paperSpecChip'),
        pageCountChip: byId('pageCountChip'),
        resetAllTransformsBtn: byId('resetAllTransformsBtn'),
        viewStackBtn: byId('viewStackBtn'),
        viewGridBtn: byId('viewGridBtn'),
        guidesToggleBtn: byId('guidesToggleBtn'),
        zoomOutBtn: byId('zoomOutBtn'),
        zoomFitBtn: byId('zoomFitBtn'),
        zoomInBtn: byId('zoomInBtn'),

        // Selected Photo Free Transform panel
        sectionSelectedTransform: byId('sectionSelectedTransform'),
        tfSelectedName: byId('tfSelectedName'),
        tfWidthInput: byId('tfWidthInput'),
        tfHeightInput: byId('tfHeightInput'),
        tfOffsetXInput: byId('tfOffsetXInput'),
        tfOffsetYInput: byId('tfOffsetYInput'),
        tfAngleInput: byId('tfAngleInput'),
        tfAngleRange: byId('tfAngleRange'),
        tfBringFrontBtn: byId('tfBringFrontBtn'),
        tfResetBtn: byId('tfResetBtn'),
        tfDoneBtn: byId('tfDoneBtn'),

        // Inspector sections
        unitBtns: Array.from(document.querySelectorAll('.unit-btn')),
        unitLabels: Array.from(document.querySelectorAll('.unit-label')),
        sectionOnePerPage: byId('sectionOnePerPage'),
        sectionCustomGrid: byId('sectionCustomGrid'),
        sectionAllOnOne: byId('sectionAllOnOne'),

        // Mode 1: One Per Page
        sizingCards: Array.from(document.querySelectorAll('.sizing-card')),
        centerSubpanel: byId('centerSubpanel'),
        centerDpiSelect: byId('centerDpiSelect'),
        centerDpiHelp: byId('centerDpiHelp'),
        freeformSubpanel: byId('freeformSubpanel'),
        freeformWidthInput: byId('freeformWidthInput'),
        freeformHeightInput: byId('freeformHeightInput'),
        freeformLockBtn: byId('freeformLockBtn'),
        freeformPresetBtns: Array.from(document.querySelectorAll('[data-freeform-w]')),
        freeformFitBtns: Array.from(document.querySelectorAll('[data-freeform-fit]')),
        alignDots: Array.from(document.querySelectorAll('.align-dot')),

        // Mode 2: Custom Grid
        gridPresetBtns: Array.from(document.querySelectorAll('[data-grid-preset]')),
        customRowsInput: byId('customRowsInput'),
        customColsInput: byId('customColsInput'),
        customGapRange: byId('customGapRange'),
        customGapValue: byId('customGapValue'),
        gridFitBtns: Array.from(document.querySelectorAll('[data-grid-fit]')),
        customGridSummary: byId('customGridSummary'),

        // Mode 3: All on One Page
        allOnOneAutoToggle: byId('allOnOneAutoToggle'),
        allRowsInput: byId('allRowsInput'),
        allColsInput: byId('allColsInput'),
        allGapRange: byId('allGapRange'),
        allGapValue: byId('allGapValue'),
        allFitBtns: Array.from(document.querySelectorAll('[data-all-fit]')),
        allOnOneSummary: byId('allOnOneSummary'),

        // Stepper buttons
        stepBtns: Array.from(document.querySelectorAll('.step-btn')),

        // Page Setup
        paperSizeSelect: byId('paperSizeSelect'),
        customPaperSubpanel: byId('customPaperSubpanel'),
        customPaperWidthInput: byId('customPaperWidthInput'),
        customPaperHeightInput: byId('customPaperHeightInput'),
        orientationBtns: Array.from(document.querySelectorAll('[data-orientation]')),
        marginPresetBtns: Array.from(document.querySelectorAll('[data-margin-mm]')),
        marginRange: byId('marginRange'),
        marginValue: byId('marginValue'),

        // Output Options
        showCaptionsToggle: byId('showCaptionsToggle'),
        printCutLinesToggle: byId('printCutLinesToggle'),

        // Overlays
        dropOverlay: byId('dropOverlay'),
        toastContainer: byId('toastContainer')
      };
    }

    _bindEvents() {
      const el = this.el;

      // File upload triggers
      const openPicker = () => el.fileInput.click();
      el.headerAddBtn.addEventListener('click', openPicker);
      el.sidebarDropzone.addEventListener('click', openPicker);
      el.sidebarDropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      });
      el.emptyBrowseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPicker();
      });
      el.emptyDropzone.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openPicker();
      });
      el.emptyDropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      });

      el.fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
          await this._handleIncomingFiles(e.target.files);
          e.target.value = '';
        }
      });

      // Sample sets
      const loadSamples = async (e) => {
        if (e) e.stopPropagation();
        const btn = e ? e.currentTarget : null;
        if (btn) btn.disabled = true;
        try {
          const result = await this.store.loadSamples();
          this.showToast(`Loaded ${result.addedCount} sample images`);
        } finally {
          if (btn) btn.disabled = false;
        }
      };
      el.emptySampleBtn.addEventListener('click', loadSamples);
      el.sidebarSampleBtn.addEventListener('click', loadSamples);

      // Global Drag & Drop for files
      window.addEventListener('dragenter', (e) => {
        if (!this._isFileDrag(e)) return;
        e.preventDefault();
        this.fileDragDepth += 1;
        el.dropOverlay.hidden = false;
      });

      window.addEventListener('dragover', (e) => {
        if (!this._isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });

      window.addEventListener('dragleave', (e) => {
        if (!this._isFileDrag(e)) return;
        this.fileDragDepth = Math.max(0, this.fileDragDepth - 1);
        if (this.fileDragDepth === 0) {
          el.dropOverlay.hidden = true;
        }
      });

      window.addEventListener('drop', async (e) => {
        if (!this._isFileDrag(e)) return;
        e.preventDefault();
        this.fileDragDepth = 0;
        el.dropOverlay.hidden = true;
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          await this._handleIncomingFiles(e.dataTransfer.files);
        }
      });

      // Clipboard Paste
      window.addEventListener('paste', async (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const pastedFiles = [];
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) pastedFiles.push(file);
          }
        }
        if (pastedFiles.length > 0) {
          await this._handleIncomingFiles(pastedFiles);
        }
      });

      // Mode switcher
      el.modeTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          this.store.setLayoutMode(tab.dataset.mode);
        });
      });

      // Sidebar bulk actions
      el.reverseOrderBtn.addEventListener('click', () => {
        this.store.reverseImages();
        this.showToast('Reversed image order');
      });

      el.clearAllBtn.addEventListener('click', () => {
        this.store.clearImages();
        this.showToast('Cleared all images');
      });

      // Preview toolbar controls
      el.resetAllTransformsBtn.addEventListener('click', () => {
        this.store.resetAllTransforms();
        this.showToast('Reset all photo transforms for this mode');
      });

      el.viewStackBtn.addEventListener('click', () => {
        this.store.updatePreview({ viewMode: 'stack' });
      });

      el.viewGridBtn.addEventListener('click', () => {
        this.store.updatePreview({ viewMode: 'grid' });
      });

      el.guidesToggleBtn.addEventListener('click', () => {
        const current = this.store.getState().preview.showGuides;
        this.store.updatePreview({ showGuides: !current });
      });

      el.zoomOutBtn.addEventListener('click', () => {
        const cur = this.preview.getCurrentScale();
        const next = clamp(Math.round((cur - 0.15) * 20) / 20, 0.25, 2.0);
        this.store.updatePreview({ zoom: next });
      });

      el.zoomInBtn.addEventListener('click', () => {
        const cur = this.preview.getCurrentScale();
        const next = clamp(Math.round((cur + 0.15) * 20) / 20, 0.25, 2.0);
        this.store.updatePreview({ zoom: next });
      });

      el.zoomFitBtn.addEventListener('click', () => {
        this.store.updatePreview({ zoom: 'fit' });
      });

      // Unit switch
      el.unitBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.store.setUnit(btn.dataset.unit);
        });
      });

      // Mode 1: One Per Page sizing
      el.sizingCards.forEach((card) => {
        card.addEventListener('click', () => {
          this.store.updateOnePerPage({ sizing: card.dataset.sizing });
        });
      });

      el.centerDpiSelect.addEventListener('change', (e) => {
        this.store.updateOnePerPage({ centerDpi: Number(e.target.value) || 96 });
      });

      el.freeformLockBtn.addEventListener('click', () => {
        const opp = this.store.getState().onePerPage;
        const nextLock = !opp.freeformLockAspect;
        const ratio = opp.freeformWidthMm > 0 ? opp.freeformHeightMm / opp.freeformWidthMm : 4 / 3;
        this.store.updateOnePerPage({
          freeformLockAspect: nextLock,
          freeformAspectRatio: ratio
        });
      });

      el.freeformWidthInput.addEventListener('input', (e) => {
        const state = this.store.getState();
        const raw = parseFloat(e.target.value);
        if (isNaN(raw) || raw <= 0) return;
        const newWidthMm = clamp(unitToMm(raw, state.unit), 5, 600);
        const patch = { freeformWidthMm: newWidthMm };

        if (state.onePerPage.freeformLockAspect) {
          const ratio = state.onePerPage.freeformAspectRatio || 4 / 3;
          patch.freeformHeightMm = clamp(Number((newWidthMm * ratio).toFixed(2)), 5, 600);
        } else if (newWidthMm > 0) {
          patch.freeformAspectRatio = state.onePerPage.freeformHeightMm / newWidthMm;
        }
        this.store.updateOnePerPage(patch);
      });

      el.freeformHeightInput.addEventListener('input', (e) => {
        const state = this.store.getState();
        const raw = parseFloat(e.target.value);
        if (isNaN(raw) || raw <= 0) return;
        const newHeightMm = clamp(unitToMm(raw, state.unit), 5, 600);
        const patch = { freeformHeightMm: newHeightMm };

        if (state.onePerPage.freeformLockAspect) {
          const ratio = state.onePerPage.freeformAspectRatio || 4 / 3;
          patch.freeformWidthMm = clamp(Number((newHeightMm / ratio).toFixed(2)), 5, 600);
        } else if (state.onePerPage.freeformWidthMm > 0) {
          patch.freeformAspectRatio = newHeightMm / state.onePerPage.freeformWidthMm;
        }
        this.store.updateOnePerPage(patch);
      });

      el.freeformPresetBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const w = parseFloat(btn.dataset.freeformW);
          const h = parseFloat(btn.dataset.freeformH);
          this.store.updateOnePerPage({
            freeformWidthMm: w,
            freeformHeightMm: h,
            freeformAspectRatio: h / w
          });
        });
      });

      el.freeformFitBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.store.updateOnePerPage({ freeformFit: btn.dataset.freeformFit });
        });
      });

      el.alignDots.forEach((dot) => {
        dot.addEventListener('click', () => {
          this.store.updateOnePerPage({ freeformAlign: dot.dataset.align });
        });
      });

      // Mode 2: Custom Grid
      el.gridPresetBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const [rows, cols] = btn.dataset.gridPreset.split('x').map(Number);
          this.store.updateCustomGrid({ rows, cols });
        });
      });

      el.customRowsInput.addEventListener('change', (e) => {
        this.store.updateCustomGrid({ rows: parseInt(e.target.value, 10) || 1 });
      });

      el.customColsInput.addEventListener('change', (e) => {
        this.store.updateCustomGrid({ cols: parseInt(e.target.value, 10) || 1 });
      });

      el.customGapRange.addEventListener('input', (e) => {
        this.store.updateCustomGrid({ gapMm: parseFloat(e.target.value) });
      });

      el.gridFitBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.store.updateCustomGrid({ cellFit: btn.dataset.gridFit });
        });
      });

      // Mode 3: All on One Page
      el.allOnOneAutoToggle.addEventListener('change', (e) => {
        this.store.updateAllOnOne({ autoGrid: e.target.checked });
      });

      el.allRowsInput.addEventListener('change', (e) => {
        const plan = computeLayoutPlan(this.store.getState());
        this.store.updateAllOnOne(
          {
            autoGrid: false,
            rows: parseInt(e.target.value, 10) || 1,
            cols: plan.effectiveAllOnOne.cols
          },
          'rows'
        );
      });

      el.allColsInput.addEventListener('change', (e) => {
        const plan = computeLayoutPlan(this.store.getState());
        this.store.updateAllOnOne(
          {
            autoGrid: false,
            rows: plan.effectiveAllOnOne.rows,
            cols: parseInt(e.target.value, 10) || 1
          },
          'cols'
        );
      });

      el.allGapRange.addEventListener('input', (e) => {
        this.store.updateAllOnOne({ gapMm: parseFloat(e.target.value) });
      });

      el.allFitBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.store.updateAllOnOne({ cellFit: btn.dataset.allFit });
        });
      });

      // Stepper +/- buttons
      el.stepBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.stepTarget;
          const delta = parseInt(btn.dataset.delta, 10);
          const state = this.store.getState();

          if (target === 'customRows') {
            this.store.updateCustomGrid({ rows: state.customGrid.rows + delta });
          } else if (target === 'customCols') {
            this.store.updateCustomGrid({ cols: state.customGrid.cols + delta });
          } else if (target === 'allRows') {
            const plan = computeLayoutPlan(state);
            this.store.updateAllOnOne(
              {
                autoGrid: false,
                rows: plan.effectiveAllOnOne.rows + delta,
                cols: plan.effectiveAllOnOne.cols
              },
              'rows'
            );
          } else if (target === 'allCols') {
            const plan = computeLayoutPlan(state);
            this.store.updateAllOnOne(
              {
                autoGrid: false,
                rows: plan.effectiveAllOnOne.rows,
                cols: plan.effectiveAllOnOne.cols + delta
              },
              'cols'
            );
          }
        });
      });

      // Page setup
      el.paperSizeSelect.addEventListener('change', (e) => {
        this.store.setPaperSize(e.target.value);
      });

      el.customPaperWidthInput.addEventListener('input', (e) => {
        const state = this.store.getState();
        const raw = parseFloat(e.target.value);
        if (isNaN(raw) || raw <= 0) return;
        const mm = unitToMm(raw, state.unit);
        if (mm >= 30 && mm <= 1200) {
          this.store.setCustomPaperSize(mm, undefined);
        }
      });

      el.customPaperWidthInput.addEventListener('change', (e) => {
        const state = this.store.getState();
        const raw = parseFloat(e.target.value);
        if (isNaN(raw) || raw <= 0) {
          this.syncAll(state, 'page');
          return;
        }
        this.store.setCustomPaperSize(unitToMm(raw, state.unit), undefined);
      });

      el.customPaperHeightInput.addEventListener('input', (e) => {
        const state = this.store.getState();
        const raw = parseFloat(e.target.value);
        if (isNaN(raw) || raw <= 0) return;
        const mm = unitToMm(raw, state.unit);
        if (mm >= 30 && mm <= 1200) {
          this.store.setCustomPaperSize(undefined, mm);
        }
      });

      el.customPaperHeightInput.addEventListener('change', (e) => {
        const state = this.store.getState();
        const raw = parseFloat(e.target.value);
        if (isNaN(raw) || raw <= 0) {
          this.syncAll(state, 'page');
          return;
        }
        this.store.setCustomPaperSize(undefined, unitToMm(raw, state.unit));
      });

      el.orientationBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.store.setOrientation(btn.dataset.orientation);
        });
      });

      el.marginPresetBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.store.setMarginMm(parseFloat(btn.dataset.marginMm));
        });
      });

      el.marginRange.addEventListener('input', (e) => {
        this.store.setMarginMm(parseFloat(e.target.value));
      });

      // Output toggles
      el.showCaptionsToggle.addEventListener('change', (e) => {
        this.store.updateOutput({ showCaptions: e.target.checked });
      });

      el.printCutLinesToggle.addEventListener('change', (e) => {
        this.store.updateOutput({ printCutLines: e.target.checked });
      });

      // Selected Photo Free Transform Inspector Controls
      const applySelectedSize = (axis, rawVal) => {
        const state = this.store.getState();
        const id = state.selectedImageId;
        if (!id) return;
        const val = parseFloat(rawVal);
        if (isNaN(val) || val <= 0) return;
        const mm = clamp(unitToMm(val, state.unit), 8, 1200);
        const plan = computeLayoutPlan(state);
        const entry = plan.itemsById && plan.itemsById[id];
        if (!entry) return;
        if (axis === 'w') {
          this.store.setImageTransform(id, { widthMm: mm, heightMm: entry.item.heightMm });
        } else {
          this.store.setImageTransform(id, { widthMm: entry.item.widthMm, heightMm: mm });
        }
      };

      el.tfWidthInput.addEventListener('change', (e) => applySelectedSize('w', e.target.value));
      el.tfHeightInput.addEventListener('change', (e) => applySelectedSize('h', e.target.value));

      el.tfOffsetXInput.addEventListener('input', (e) => {
        const state = this.store.getState();
        if (!state.selectedImageId) return;
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        this.store.setImageTransform(state.selectedImageId, { xMm: unitToMm(val, state.unit) });
      });

      el.tfOffsetYInput.addEventListener('input', (e) => {
        const state = this.store.getState();
        if (!state.selectedImageId) return;
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        this.store.setImageTransform(state.selectedImageId, { yMm: unitToMm(val, state.unit) });
      });

      el.tfAngleRange.addEventListener('input', (e) => {
        const id = this.store.getState().selectedImageId;
        if (!id) return;
        this.store.setImageTransform(id, { angle: parseFloat(e.target.value) || 0 });
      });

      el.tfAngleInput.addEventListener('input', (e) => {
        const id = this.store.getState().selectedImageId;
        if (!id) return;
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        this.store.setImageTransform(id, { angle: val });
      });

      el.tfBringFrontBtn.addEventListener('click', () => {
        const id = this.store.getState().selectedImageId;
        if (!id) return;
        this.store.bringImageForward(id);
      });

      el.tfResetBtn.addEventListener('click', () => {
        const id = this.store.getState().selectedImageId;
        if (!id) return;
        this.store.resetImageTransform(id);
        this.showToast('Photo transform reset');
      });

      el.tfDoneBtn.addEventListener('click', () => {
        this.store.selectImage(null);
      });

      // Print action
      el.printBtn.addEventListener('click', () => this.triggerPrint());

      // Keyboard shortcuts: Ctrl+P to print, Esc to deselect, Arrows to nudge selected photo
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
          if (this.store.getState().images.length > 0) {
            e.preventDefault();
            this.triggerPrint();
          }
          return;
        }

        const state = this.store.getState();
        if (!state.selectedImageId) return;

        // Do not hijack keys when typing in form controls
        const tag = document.activeElement && document.activeElement.tagName;
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

        if (e.key === 'Escape') {
          if (isTyping) {
            document.activeElement.blur();
          }
          this.store.selectImage(null);
          return;
        }

        if (isTyping) return;

        const step = e.shiftKey ? 5 : 1;
        const t = this.store.getImageTransform(state.selectedImageId);
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.store.setImageTransform(state.selectedImageId, { xMm: t.xMm - step });
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.store.setImageTransform(state.selectedImageId, { xMm: t.xMm + step });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.store.setImageTransform(state.selectedImageId, { yMm: t.yMm - step });
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.store.setImageTransform(state.selectedImageId, { yMm: t.yMm + step });
        }
      });

      // Responsive drawer controls
      const closeDrawers = () => {
        el.sidebarPanel.classList.remove('open');
        el.inspectorPanel.classList.remove('open');
        el.drawerBackdrop.hidden = true;
      };
      el.toggleSidebarBtn.addEventListener('click', () => {
        const opening = !el.sidebarPanel.classList.contains('open');
        closeDrawers();
        if (opening) {
          el.sidebarPanel.classList.add('open');
          el.drawerBackdrop.hidden = false;
        }
      });
      el.toggleInspectorBtn.addEventListener('click', () => {
        const opening = !el.inspectorPanel.classList.contains('open');
        closeDrawers();
        if (opening) {
          el.inspectorPanel.classList.add('open');
          el.drawerBackdrop.hidden = false;
        }
      });
      el.closeSidebarBtn.addEventListener('click', closeDrawers);
      el.closeInspectorBtn.addEventListener('click', closeDrawers);
      el.drawerBackdrop.addEventListener('click', closeDrawers);
    }

    _isFileDrag(e) {
      if (this.draggedImageId) return false;
      const types = e.dataTransfer && e.dataTransfer.types;
      if (!types) return false;
      return Array.from(types).includes('Files');
    }

    async _handleIncomingFiles(files) {
      const { addedCount, skippedCount } = await this.store.addFiles(files);
      if (addedCount > 0 && skippedCount === 0) {
        this.showToast(`Added ${addedCount} ${addedCount === 1 ? 'image' : 'images'}`);
      } else if (addedCount > 0 && skippedCount > 0) {
        this.showToast(`Added ${addedCount} images (${skippedCount} unsupported skipped)`);
      } else if (skippedCount > 0) {
        this.showToast('Only JPEG, PNG, GIF, and WebP images are supported', true);
      }
    }

    async triggerPrint() {
      const state = this.store.getState();
      if (state.images.length === 0) return;

      // Ensure every image in the printable sheets is fully decoded before invoking browser print dialog
      const imgs = Array.from(document.querySelectorAll('.print-sheet img'));
      await Promise.all(
        imgs.map((img) => {
          if (img.complete && img.naturalWidth > 0) {
            return typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
          }
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        })
      );

      window.print();
    }

    syncAll(state, reason) {
      const plan = computeLayoutPlan(state);

      this._syncHeaderAndToolbar(state, plan);
      this._syncInspector(state, plan);

      if (reason === 'init' || reason === 'images') {
        this._renderImageQueue(state);
      } else if (reason === 'selection') {
        this._syncImageQueueSelection(state);
      }

      if (reason === 'selection') {
        this.preview.renderSelectionOverlay(state, plan);
      } else if (reason === 'preview') {
        this.el.viewStackBtn.classList.toggle('active', state.preview.viewMode === 'stack');
        this.el.viewGridBtn.classList.toggle('active', state.preview.viewMode === 'grid');
        this.el.guidesToggleBtn.classList.toggle('active', state.preview.showGuides);
        document.getElementById('sheetsContainer').classList.toggle('show-guides', state.preview.showGuides);
        document.getElementById('sheetsContainer').classList.toggle('grid-view', state.preview.viewMode === 'grid');
        this.preview.updateZoomScale(state, plan);
      } else {
        this.preview.render(state, plan);
      }
    }

    _syncHeaderAndToolbar(state, plan) {
      const el = this.el;
      const imgCount = state.images.length;
      const pageCount = plan.sheets.length;

      // Topbar summary & Print button
      if (imgCount === 0) {
        el.headerSummary.textContent = 'No images loaded';
      } else {
        el.headerSummary.textContent = `${imgCount} ${imgCount === 1 ? 'image' : 'images'} · ${pageCount} ${
          pageCount === 1 ? 'page' : 'pages'
        } · ${plan.metrics.paperLabel}`;
      }

      el.printBtn.disabled = imgCount === 0;
      el.printPageBadge.hidden = pageCount === 0;
      el.printPageBadge.textContent = String(pageCount);

      // Counts
      el.imageCountPill.textContent = String(imgCount);
      el.mobileImageCount.textContent = String(imgCount);
      el.reverseOrderBtn.disabled = imgCount < 2;
      el.clearAllBtn.disabled = imgCount === 0;
      el.sidebarEmpty.hidden = imgCount > 0;

      // Mode tabs
      el.modeTabs.forEach((tab) => {
        const isActive = tab.dataset.mode === state.layoutMode;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
      });

      // Preview toolbar chips
      const dimText = formatDimensions(plan.metrics.pageWidthMm, plan.metrics.pageHeightMm, state.unit);
      const orientText = plan.metrics.orientation === 'portrait' ? 'Portrait' : 'Landscape';
      el.paperSpecChip.textContent = `${plan.metrics.paperLabel} ${orientText} · ${dimText}`;
      el.pageCountChip.textContent = `${pageCount} ${pageCount === 1 ? 'Page' : 'Pages'}`;

      el.viewStackBtn.classList.toggle('active', state.preview.viewMode === 'stack');
      el.viewGridBtn.classList.toggle('active', state.preview.viewMode === 'grid');
      el.guidesToggleBtn.classList.toggle('active', state.preview.showGuides);
      el.resetAllTransformsBtn.hidden = !this.store.hasAnyTransform(state.layoutMode);
    }

    _syncSelectedTransformFields(item) {
      const el = this.el;
      const state = this.store.getState();
      const unit = state.unit;
      const stepVal = unit === 'in' ? '0.1' : '1';

      el.tfWidthInput.step = stepVal;
      el.tfHeightInput.step = stepVal;
      el.tfOffsetXInput.step = stepVal;
      el.tfOffsetYInput.step = stepVal;

      if (document.activeElement !== el.tfWidthInput) {
        el.tfWidthInput.value = formatUnitValue(item.widthMm, unit);
      }
      if (document.activeElement !== el.tfHeightInput) {
        el.tfHeightInput.value = formatUnitValue(item.heightMm, unit);
      }
      if (document.activeElement !== el.tfOffsetXInput) {
        el.tfOffsetXInput.value = formatUnitValue(item.dxMm, unit);
      }
      if (document.activeElement !== el.tfOffsetYInput) {
        el.tfOffsetYInput.value = formatUnitValue(item.dyMm, unit);
      }
      if (document.activeElement !== el.tfAngleInput) {
        el.tfAngleInput.value = String(Math.round(item.angle * 10) / 10);
      }
      el.tfAngleRange.value = String(Math.round(item.angle));
      el.tfResetBtn.disabled = !item.isTransformed;
      el.resetAllTransformsBtn.hidden = !this.store.hasAnyTransform(state.layoutMode);
    }

    _syncInspector(state, plan) {
      const el = this.el;
      const unit = state.unit;

      // Units
      el.unitBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.unit === unit));
      el.unitLabels.forEach((lbl) => {
        lbl.textContent = unit;
      });

      // Visible mode section
      el.sectionOnePerPage.hidden = state.layoutMode !== 'one-per-page';
      el.sectionCustomGrid.hidden = state.layoutMode !== 'custom-grid';
      el.sectionAllOnOne.hidden = state.layoutMode !== 'all-on-one';

      // Selected Photo Free Transform panel
      const selectedEntry =
        state.selectedImageId && plan.itemsById ? plan.itemsById[state.selectedImageId] : null;
      el.sectionSelectedTransform.hidden = !selectedEntry;
      if (selectedEntry) {
        el.tfSelectedName.textContent = selectedEntry.item.image.name;
        this._syncSelectedTransformFields(selectedEntry.item);
      }

      // Mode 1: One Image Per Page
      const opp = state.onePerPage;
      el.sizingCards.forEach((card) => {
        const active = card.dataset.sizing === opp.sizing;
        card.classList.toggle('active', active);
        card.setAttribute('aria-checked', String(active));
      });
      el.centerSubpanel.hidden = opp.sizing !== 'center';
      el.freeformSubpanel.hidden = opp.sizing !== 'freeform';

      el.centerDpiSelect.value = String(opp.centerDpi);
      if (plan.centerOverflowCount > 0) {
        el.centerDpiHelp.className = 'field-help warn';
        el.centerDpiHelp.textContent = `${plan.centerOverflowCount} ${
          plan.centerOverflowCount === 1 ? 'image exceeds' : 'images exceed'
        } the printable area at ${opp.centerDpi} DPI and will be clipped at the margins. Increase DPI or switch to Best Fit.`;
      } else {
        el.centerDpiHelp.className = 'field-help';
        el.centerDpiHelp.textContent = `Prints images at natural pixel size (${opp.centerDpi} pixels per inch), centered on the page.`;
      }

      // Freeform inputs (avoid clobbering focused input while typing)
      const stepVal = unit === 'in' ? '0.1' : '1';
      el.freeformWidthInput.step = stepVal;
      el.freeformHeightInput.step = stepVal;

      if (document.activeElement !== el.freeformWidthInput) {
        el.freeformWidthInput.value = formatUnitValue(opp.freeformWidthMm, unit);
      }
      if (document.activeElement !== el.freeformHeightInput) {
        el.freeformHeightInput.value = formatUnitValue(opp.freeformHeightMm, unit);
      }

      el.freeformLockBtn.classList.toggle('active', opp.freeformLockAspect);
      el.freeformLockBtn.setAttribute('aria-pressed', String(opp.freeformLockAspect));

      el.freeformPresetBtns.forEach((btn) => {
        const match =
          Math.abs(parseFloat(btn.dataset.freeformW) - opp.freeformWidthMm) < 0.6 &&
          Math.abs(parseFloat(btn.dataset.freeformH) - opp.freeformHeightMm) < 0.6;
        btn.classList.toggle('active', match);
      });

      el.freeformFitBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.freeformFit === opp.freeformFit);
      });

      el.alignDots.forEach((dot) => {
        dot.classList.toggle('active', dot.dataset.align === opp.freeformAlign);
      });

      // Mode 2: Custom Grid
      const cg = state.customGrid;
      el.customRowsInput.value = String(cg.rows);
      el.customColsInput.value = String(cg.cols);
      el.customGapRange.value = String(cg.gapMm);
      el.customGapValue.textContent = formatUnitValue(cg.gapMm, unit);

      el.gridPresetBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.gridPreset === `${cg.rows}x${cg.cols}`);
      });

      el.gridFitBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.gridFit === cg.cellFit);
      });

      const perPage = cg.rows * cg.cols;
      const customPages = state.images.length > 0 ? Math.ceil(state.images.length / perPage) : 0;
      el.customGridSummary.textContent =
        state.images.length > 0
          ? `${perPage} images per page · ${state.images.length} images across ${customPages} ${
              customPages === 1 ? 'page' : 'pages'
            }.`
          : `Places up to ${perPage} images on each page.`;

      // Mode 3: All on One Page
      const aoo = state.allOnOne;
      const eff = plan.effectiveAllOnOne;
      el.allOnOneAutoToggle.checked = aoo.autoGrid;
      el.allRowsInput.value = String(eff.rows);
      el.allColsInput.value = String(eff.cols);
      el.allGapRange.value = String(aoo.gapMm);
      el.allGapValue.textContent = formatUnitValue(aoo.gapMm, unit);

      el.allFitBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.allFit === aoo.cellFit);
      });

      el.allOnOneSummary.textContent =
        state.images.length > 0
          ? `Fitting all ${state.images.length} ${state.images.length === 1 ? 'image' : 'images'} into a ${eff.rows} × ${
              eff.cols
            } single-page grid.`
          : 'Automatically arranges every uploaded image onto 1 page.';

      // Page Setup
      el.paperSizeSelect.value = state.paperSize;
      const isCustomPaper = state.paperSize === 'custom';
      el.customPaperSubpanel.hidden = !isCustomPaper;

      const paperStep = unit === 'in' ? '0.1' : '1';
      const paperMin = unit === 'in' ? '1.2' : '30';
      const paperMax = unit === 'in' ? '47.2' : '1200';
      el.customPaperWidthInput.step = paperStep;
      el.customPaperWidthInput.min = paperMin;
      el.customPaperWidthInput.max = paperMax;
      el.customPaperHeightInput.step = paperStep;
      el.customPaperHeightInput.min = paperMin;
      el.customPaperHeightInput.max = paperMax;

      if (document.activeElement !== el.customPaperWidthInput) {
        el.customPaperWidthInput.value = formatUnitValue(state.customPaperWidthMm, unit);
      }
      if (document.activeElement !== el.customPaperHeightInput) {
        el.customPaperHeightInput.value = formatUnitValue(state.customPaperHeightMm, unit);
      }

      el.orientationBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.orientation === plan.metrics.orientation);
      });

      el.marginRange.value = String(plan.metrics.marginMm);
      el.marginValue.textContent = formatUnitValue(plan.metrics.marginMm, unit);
      el.marginPresetBtns.forEach((btn) => {
        btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.marginMm) - plan.metrics.marginMm) < 0.4);
      });

      // Output toggles
      el.showCaptionsToggle.checked = state.output.showCaptions;
      el.printCutLinesToggle.checked = state.output.printCutLines;
    }

    _renderImageQueue(state) {
      const list = this.el.imageList;
      list.innerHTML = '';

      const fragment = document.createDocumentFragment();
      const total = state.images.length;

      state.images.forEach((img, index) => {
        const li = document.createElement('li');
        li.className = 'image-item';
        if (img.id === state.selectedImageId) {
          li.classList.add('is-selected');
        }
        li.draggable = true;
        li.dataset.id = img.id;
        li.dataset.index = String(index);

        li.innerHTML = `
          <div class="drag-handle" title="Drag to reorder" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
              <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
            </svg>
          </div>
          <div class="item-thumb-wrap">
            <img class="item-thumb" alt="" />
            <span class="item-index">${index + 1}</span>
          </div>
          <div class="item-meta">
            <span class="item-name"></span>
            <span class="item-dims">${img.naturalWidth} × ${img.naturalHeight}</span>
          </div>
          <div class="item-controls">
            <div class="item-move-col">
              <button class="item-action-btn move-up" type="button" title="Move up" aria-label="Move image up" ${
                index === 0 ? 'disabled' : ''
              }>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="18 15 12 9 6 15"/></svg>
              </button>
              <button class="item-action-btn move-down" type="button" title="Move down" aria-label="Move image down" ${
                index === total - 1 ? 'disabled' : ''
              }>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>
            <button class="item-action-btn rotate" type="button" title="Rotate 90° clockwise" aria-label="Rotate image 90 degrees">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
            </button>
            <button class="item-action-btn duplicate" type="button" title="Duplicate image" aria-label="Duplicate image">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="item-action-btn remove" type="button" title="Remove image" aria-label="Remove image">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        `;

        const thumb = li.querySelector('.item-thumb');
        thumb.src = img.url;
        thumb.alt = img.name;

        const nameEl = li.querySelector('.item-name');
        nameEl.textContent = img.name;
        nameEl.title = img.name;

        // Click card to select photo for Free Transform & scroll into view
        li.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          this.store.selectImage(img.id);
          this.preview.scrollToImage(img.id);
        });

        // Button actions
        li.querySelector('.move-up').addEventListener('click', () => {
          this.store.moveImage(index, index - 1);
        });
        li.querySelector('.move-down').addEventListener('click', () => {
          this.store.moveImage(index, index + 1);
        });
        li.querySelector('.rotate').addEventListener('click', () => {
          this.store.rotateImage(img.id).catch(() => {
            this.showToast('Could not rotate this image', true);
          });
        });
        li.querySelector('.duplicate').addEventListener('click', () => {
          this.store.duplicateImage(img.id);
        });
        li.querySelector('.remove').addEventListener('click', () => {
          this.store.removeImage(img.id);
        });

        // HTML5 Drag & Drop reordering
        li.addEventListener('dragstart', (e) => {
          this.draggedImageId = img.id;
          li.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', img.id);
        });

        li.addEventListener('dragend', () => {
          this.draggedImageId = null;
          li.classList.remove('dragging');
          list.querySelectorAll('.image-item').forEach((item) => {
            item.classList.remove('drag-over-top', 'drag-over-bottom');
          });
        });

        li.addEventListener('dragover', (e) => {
          if (!this.draggedImageId || this.draggedImageId === img.id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = li.getBoundingClientRect();
          const isTopHalf = e.clientY < rect.top + rect.height / 2;
          li.classList.toggle('drag-over-top', isTopHalf);
          li.classList.toggle('drag-over-bottom', !isTopHalf);
        });

        li.addEventListener('dragleave', () => {
          li.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        li.addEventListener('drop', (e) => {
          if (!this.draggedImageId || this.draggedImageId === img.id) return;
          e.preventDefault();
          e.stopPropagation();

          const currentImages = this.store.getState().images;
          const fromIdx = currentImages.findIndex((x) => x.id === this.draggedImageId);
          let toIdx = currentImages.findIndex((x) => x.id === img.id);
          const rect = li.getBoundingClientRect();
          const isBottomHalf = e.clientY >= rect.top + rect.height / 2;

          if (fromIdx < toIdx && !isBottomHalf) {
            toIdx -= 1;
          } else if (fromIdx > toIdx && isBottomHalf) {
            toIdx += 1;
          }

          this.draggedImageId = null;
          this.store.moveImage(fromIdx, toIdx);
        });

        fragment.appendChild(li);
      });

      list.appendChild(fragment);
    }

    _syncImageQueueSelection(state) {
      const items = this.el.imageList.querySelectorAll('.image-item');
      items.forEach((li) => {
        li.classList.toggle('is-selected', li.dataset.id === state.selectedImageId);
      });
    }

    showToast(message, isError = false) {
      const toast = document.createElement('div');
      toast.className = isError ? 'toast error' : 'toast';
      toast.textContent = message;
      this.el.toastContainer.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(6px)';
        toast.style.transition = 'opacity 180ms ease, transform 180ms ease';
        setTimeout(() => toast.remove(), 200);
      }, 2600);
    }
  }

  global.EZPrint = global.EZPrint || {};
  global.EZPrint.UIController = UIController;
})(window);
