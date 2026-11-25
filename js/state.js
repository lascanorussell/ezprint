/* ==========================================================================
   EZ-Print Reactive State Store & Image Manager
   ========================================================================== */
(function (global) {
  'use strict';

  const { PAPER_SIZES, isSupportedImageFile, clamp } = global.EZPrint.Constants;

  let nextIdCounter = 1;
  let nextZIndex = 2;

  function createEmptyTransform() {
    return {
      xMm: 0,
      yMm: 0,
      widthMm: null,
      heightMm: null,
      angle: 0,
      zIndex: 1
    };
  }

  function isTransformModified(t) {
    if (!t) return false;
    return (
      Math.abs(t.xMm || 0) > 0.01 ||
      Math.abs(t.yMm || 0) > 0.01 ||
      (t.widthMm !== null && t.widthMm !== undefined) ||
      (t.heightMm !== null && t.heightMm !== undefined) ||
      Math.abs(t.angle || 0) > 0.01
    );
  }

  function createInitialState() {
    return {
      images: [],
      selectedImageId: null,
      layoutMode: 'one-per-page', // 'one-per-page' | 'custom-grid' | 'all-on-one'

      // Paper & global page setup (stored internally in mm)
      paperSize: 'a4',
      customPaperWidthMm: 210,
      customPaperHeightMm: 297,
      orientation: 'portrait', // 'portrait' | 'landscape'
      unit: 'mm', // 'mm' | 'in'
      marginMm: 10,

      // Mode 1: One Image Per Page
      onePerPage: {
        sizing: 'best-fit', // 'best-fit' | 'stretch' | 'center' | 'freeform'
        centerDpi: 96,
        freeformWidthMm: 120,
        freeformHeightMm: 160,
        freeformLockAspect: true,
        freeformAspectRatio: 160 / 120, // height / width
        freeformFit: 'contain', // 'contain' | 'fill' | 'cover'
        freeformAlign: 'center-center'
      },

      // Mode 2: Custom Grid (Multi-Page)
      customGrid: {
        rows: 2,
        cols: 2,
        gapMm: 6,
        cellFit: 'contain' // 'contain' | 'cover' | 'fill'
      },

      // Mode 3: All Images on One Page
      allOnOne: {
        autoGrid: true,
        rows: 2,
        cols: 2,
        gapMm: 4,
        cellFit: 'contain' // 'contain' | 'cover' | 'fill'
      },

      // Preview & Print Output options
      preview: {
        zoom: 'fit', // 'fit' | number (0.25 .. 2.0)
        viewMode: 'stack', // 'stack' | 'grid'
        showGuides: true
      },
      output: {
        showCaptions: false,
        printCutLines: false
      }
    };
  }

  function loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = url;
    });
  }

  function rotateImageBlobUrl(sourceUrl, sourceType) {
    return loadImageElement(sourceUrl).then((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalHeight;
      canvas.height = img.naturalWidth;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

      const outputMime = sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Could not rotate image'));
              return;
            }
            const rotatedUrl = URL.createObjectURL(blob);
            resolve({
              url: rotatedUrl,
              width: canvas.width,
              height: canvas.height
            });
          },
          outputMime,
          0.95
        );
      });
    });
  }

  /**
   * Generates crisp, varied aspect-ratio sample artwork locally on Canvas
   * so users can test every layout mode offline with zero external requests.
   */
  function generateSampleFiles() {
    const specs = [
      { name: 'Alpine-Sunrise.png', w: 1200, h: 900, theme: 'mountain', accent: '#f97316', bg1: '#0f172a', bg2: '#3b82f6' },
      { name: 'Botanical-Study.png', w: 900, h: 1200, theme: 'botanical', accent: '#10b981', bg1: '#ecfdf5', bg2: '#d1fae5' },
      { name: 'Nordic-Architecture.png', w: 1200, h: 800, theme: 'arch', accent: '#2563eb', bg1: '#f8fafc', bg2: '#dbeafe' },
      { name: 'Golden-Coastline.png', w: 1000, h: 1000, theme: 'coast', accent: '#eab308', bg1: '#fffbeb', bg2: '#fed7aa' },
      { name: 'Studio-Poster-05.png', w: 900, h: 1260, theme: 'bauhaus', accent: '#ef4444', bg1: '#18181b', bg2: '#27272a' },
      { name: 'Kyoto-Lanterns.png', w: 1280, h: 860, theme: 'night', accent: '#ec4899', bg1: '#1e1b4b', bg2: '#312e81' }
    ];

    const promises = specs.map((spec, idx) => {
      const canvas = document.createElement('canvas');
      canvas.width = spec.w;
      canvas.height = spec.h;
      const ctx = canvas.getContext('2d');

      const grad = ctx.createLinearGradient(0, 0, spec.w, spec.h);
      grad.addColorStop(0, spec.bg1);
      grad.addColorStop(1, spec.bg2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, spec.w, spec.h);

      if (spec.theme === 'mountain') {
        // Sun
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(spec.w * 0.72, spec.h * 0.28, 95, 0, Math.PI * 2);
        ctx.fill();
        // Mountain ranges
        ctx.fillStyle = '#1e3a8a';
        ctx.beginPath();
        ctx.moveTo(0, spec.h);
        ctx.lineTo(spec.w * 0.28, spec.h * 0.42);
        ctx.lineTo(spec.w * 0.58, spec.h * 0.74);
        ctx.lineTo(spec.w * 0.82, spec.h * 0.38);
        ctx.lineTo(spec.w, spec.h * 0.65);
        ctx.lineTo(spec.w, spec.h);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.moveTo(0, spec.h);
        ctx.lineTo(spec.w * 0.18, spec.h * 0.62);
        ctx.lineTo(spec.w * 0.48, spec.h * 0.52);
        ctx.lineTo(spec.w * 0.74, spec.h * 0.82);
        ctx.lineTo(spec.w, spec.h * 0.7);
        ctx.lineTo(spec.w, spec.h);
        ctx.closePath();
        ctx.fill();
      } else if (spec.theme === 'botanical') {
        ctx.fillStyle = '#065f46';
        ctx.fillRect(spec.w * 0.485, spec.h * 0.22, 16, spec.h * 0.68);
        const leaves = [
          [0.49, 0.34, -0.7, 150, 58],
          [0.50, 0.44, 0.65, 175, 64],
          [0.49, 0.56, -0.6, 190, 72],
          [0.50, 0.67, 0.58, 170, 62],
          [0.49, 0.25, 0, 115, 52]
        ];
        leaves.forEach(([x, y, ang, rx, ry], i) => {
          ctx.save();
          ctx.translate(spec.w * x, spec.h * y);
          ctx.rotate(ang);
          ctx.fillStyle = i % 2 === 0 ? '#059669' : '#10b981';
          ctx.beginPath();
          ctx.ellipse(ang < 0 ? -rx * 0.6 : ang > 0 ? rx * 0.6 : 0, 0, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      } else if (spec.theme === 'arch') {
        // Minimalist architectural facade
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(spec.w * 0.12, spec.h * 0.16, spec.w * 0.44, spec.h * 0.84);
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(spec.w * 0.56, spec.h * 0.3, spec.w * 0.32, spec.h * 0.7);
        ctx.fillStyle = '#f8fafc';
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 3; c++) {
            ctx.fillRect(spec.w * 0.17 + c * 130, spec.h * 0.24 + r * 105, 84, 64);
          }
        }
        ctx.fillStyle = '#93c5fd';
        for (let r = 0; r < 4; r++) {
          ctx.fillRect(spec.w * 0.62, spec.h * 0.38 + r * 115, spec.w * 0.2, 54);
        }
      } else if (spec.theme === 'coast') {
        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        ctx.arc(spec.w * 0.5, spec.h * 0.46, 175, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(0, spec.h * 0.54, spec.w, spec.h * 0.46);
        ctx.fillStyle = '#38bdf8';
        for (let i = 0; i < 6; i++) {
          ctx.fillRect(spec.w * (0.28 + (i % 2) * 0.04), spec.h * (0.58 + i * 0.065), spec.w * (0.44 - i * 0.05), 14);
        }
      } else if (spec.theme === 'bauhaus') {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(spec.w * 0.5, spec.h * 0.36, 230, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.moveTo(spec.w * 0.14, spec.h * 0.86);
        ctx.lineTo(spec.w * 0.5, spec.h * 0.42);
        ctx.lineTo(spec.w * 0.86, spec.h * 0.86);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(spec.w * 0.14, spec.h * 0.11, spec.w * 0.72, 26);
      } else {
        // Kyoto night lanterns
        const lanternXs = [0.22, 0.42, 0.62, 0.8];
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(0, spec.h * 0.18);
        ctx.quadraticCurveTo(spec.w * 0.5, spec.h * 0.3, spec.w, spec.h * 0.16);
        ctx.stroke();

        lanternXs.forEach((lx, i) => {
          const cx = spec.w * lx;
          const cy = spec.h * (0.42 + (i % 2) * 0.09);
          const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, 150);
          glow.addColorStop(0, 'rgba(244, 114, 182, 0.75)');
          glow.addColorStop(1, 'rgba(244, 114, 182, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(cx, cy, 150, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = i % 2 === 0 ? '#f43f5e' : '#fb923c';
          ctx.beginPath();
          ctx.ellipse(cx, cy, 56, 78, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#111827';
          ctx.fillRect(cx - 28, cy - 86, 56, 16);
          ctx.fillRect(cx - 24, cy + 70, 48, 14);
        });
      }

      // Subtle print-proof corner caption inside sample image
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.fillRect(28, spec.h - 74, 290, 44);
      ctx.fillStyle = '#0f172a';
      ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(`0${idx + 1} · ${spec.name.replace('.png', '')}`, 44, spec.h - 45);

      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const file = new File([blob], spec.name, { type: 'image/png' });
          resolve(file);
        }, 'image/png');
      });
    });

    return Promise.all(promises);
  }

  class Store {
    constructor() {
      this.state = createInitialState();
      this.listeners = new Set();
    }

    getState() {
      return this.state;
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    notify(reason = 'update') {
      this.listeners.forEach((fn) => fn(this.state, reason));
    }

    selectImage(id) {
      const normalized = id || null;
      if (this.state.selectedImageId === normalized) return;
      this.state.selectedImageId = normalized;
      this.notify('selection');
    }

    getImageTransform(imageId, mode) {
      const m = mode || this.state.layoutMode;
      const item = this.state.images.find((img) => img.id === imageId);
      if (!item || !item.transforms || !item.transforms[m]) {
        return createEmptyTransform();
      }
      return { ...createEmptyTransform(), ...item.transforms[m] };
    }

    setImageTransform(imageId, patch, mode, silent = false) {
      const m = mode || this.state.layoutMode;
      const item = this.state.images.find((img) => img.id === imageId);
      if (!item) return;
      if (!item.transforms) item.transforms = {};
      const current = item.transforms[m] ? { ...createEmptyTransform(), ...item.transforms[m] } : createEmptyTransform();
      const updated = { ...current, ...patch };
      if (updated.widthMm !== null && updated.widthMm !== undefined) {
        updated.widthMm = clamp(Number(updated.widthMm), 8, 1200);
      }
      if (updated.heightMm !== null && updated.heightMm !== undefined) {
        updated.heightMm = clamp(Number(updated.heightMm), 8, 1200);
      }
      if (updated.angle !== undefined) {
        let a = Number(updated.angle) || 0;
        while (a > 180) a -= 360;
        while (a <= -180) a += 360;
        updated.angle = Math.round(a * 10) / 10;
      }
      item.transforms[m] = updated;
      if (!silent) {
        this.notify('transform');
      }
    }

    bringImageForward(imageId, mode, silent = false) {
      const m = mode || this.state.layoutMode;
      const item = this.state.images.find((img) => img.id === imageId);
      if (!item) return;
      if (!item.transforms) item.transforms = {};
      const current = item.transforms[m] ? { ...createEmptyTransform(), ...item.transforms[m] } : createEmptyTransform();
      current.zIndex = nextZIndex++;
      item.transforms[m] = current;
      if (!silent) {
        this.notify('transform');
      }
    }

    resetImageTransform(imageId, mode) {
      const m = mode || this.state.layoutMode;
      const item = this.state.images.find((img) => img.id === imageId);
      if (!item || !item.transforms || !item.transforms[m]) return;
      delete item.transforms[m];
      this.notify('transform');
    }

    resetAllTransforms(mode) {
      const m = mode || this.state.layoutMode;
      let changed = false;
      this.state.images.forEach((item) => {
        if (item.transforms && item.transforms[m]) {
          delete item.transforms[m];
          changed = true;
        }
      });
      if (changed) {
        this.notify('transform');
      }
    }

    hasAnyTransform(mode) {
      const m = mode || this.state.layoutMode;
      return this.state.images.some((item) => item.transforms && isTransformModified(item.transforms[m]));
    }

    setLayoutMode(mode) {
      if (this.state.layoutMode === mode) return;
      this.state.layoutMode = mode;
      this.notify('layout');
    }

    setPaperSize(paperSize) {
      if (paperSize === 'custom' && this.state.paperSize !== 'custom') {
        const prev = PAPER_SIZES[this.state.paperSize] || PAPER_SIZES.a4;
        const isLandscape = this.state.orientation === 'landscape';
        this.state.customPaperWidthMm = isLandscape ? prev.heightMm : prev.widthMm;
        this.state.customPaperHeightMm = isLandscape ? prev.widthMm : prev.heightMm;
      }
      this.state.paperSize = paperSize;
      this.notify('page');
    }

    setCustomPaperSize(widthMm, heightMm) {
      if (widthMm !== undefined) {
        this.state.customPaperWidthMm = clamp(Number(widthMm) || 210, 30, 1200);
      }
      if (heightMm !== undefined) {
        this.state.customPaperHeightMm = clamp(Number(heightMm) || 297, 30, 1200);
      }
      this.state.orientation =
        this.state.customPaperWidthMm > this.state.customPaperHeightMm ? 'landscape' : 'portrait';
      this.notify('page');
    }

    setOrientation(orientation) {
      if (this.state.paperSize === 'custom') {
        const w = this.state.customPaperWidthMm;
        const h = this.state.customPaperHeightMm;
        if (orientation === 'landscape' && w < h) {
          this.state.customPaperWidthMm = h;
          this.state.customPaperHeightMm = w;
        } else if (orientation === 'portrait' && w > h) {
          this.state.customPaperWidthMm = h;
          this.state.customPaperHeightMm = w;
        }
      }
      this.state.orientation = orientation;
      this.notify('page');
    }

    setUnit(unit) {
      if (this.state.unit === unit) return;
      this.state.unit = unit;
      this.notify('unit');
    }

    setMarginMm(mm) {
      this.state.marginMm = clamp(Number(mm) || 0, 0, 60);
      this.notify('layout');
    }

    updateOnePerPage(patch) {
      Object.assign(this.state.onePerPage, patch);
      this.notify('layout');
    }

    updateCustomGrid(patch) {
      if (patch.rows !== undefined) patch.rows = clamp(Math.round(Number(patch.rows) || 1), 1, 12);
      if (patch.cols !== undefined) patch.cols = clamp(Math.round(Number(patch.cols) || 1), 1, 12);
      if (patch.gapMm !== undefined) patch.gapMm = clamp(Number(patch.gapMm) || 0, 0, 40);
      Object.assign(this.state.customGrid, patch);
      this.notify('layout');
    }

    updateAllOnOne(patch, editedAxis) {
      if (patch.rows !== undefined) patch.rows = clamp(Math.round(Number(patch.rows) || 1), 1, 20);
      if (patch.cols !== undefined) patch.cols = clamp(Math.round(Number(patch.cols) || 1), 1, 20);
      if (patch.gapMm !== undefined) patch.gapMm = clamp(Number(patch.gapMm) || 0, 0, 30);

      Object.assign(this.state.allOnOne, patch);

      // Keep every uploaded image on the single page when rows/cols are changed manually
      const count = this.state.images.length;
      if (!this.state.allOnOne.autoGrid && count > 0) {
        if (editedAxis === 'rows' && this.state.allOnOne.rows * this.state.allOnOne.cols < count) {
          this.state.allOnOne.cols = clamp(Math.ceil(count / this.state.allOnOne.rows), 1, 20);
        } else if (editedAxis === 'cols' && this.state.allOnOne.rows * this.state.allOnOne.cols < count) {
          this.state.allOnOne.rows = clamp(Math.ceil(count / this.state.allOnOne.cols), 1, 20);
        }
      }

      this.notify('layout');
    }

    updatePreview(patch) {
      Object.assign(this.state.preview, patch);
      this.notify('preview');
    }

    updateOutput(patch) {
      Object.assign(this.state.output, patch);
      this.notify('layout');
    }

    async addFiles(fileList) {
      const files = Array.from(fileList || []);
      const validFiles = [];
      let skippedCount = 0;

      for (const file of files) {
        if (isSupportedImageFile(file)) {
          validFiles.push(file);
        } else {
          skippedCount += 1;
        }
      }

      const added = [];
      for (const file of validFiles) {
        const url = URL.createObjectURL(file);
        try {
          const img = await loadImageElement(url);
          added.push({
            id: `img-${nextIdCounter++}`,
            name: file.name || `Image-${nextIdCounter}`,
            type: file.type || 'image/png',
            size: file.size || 0,
            url,
            naturalWidth: img.naturalWidth || 1,
            naturalHeight: img.naturalHeight || 1,
            rotation: 0,
            transforms: {}
          });
        } catch (err) {
          URL.revokeObjectURL(url);
          skippedCount += 1;
        }
      }

      if (added.length > 0) {
        this.state.images.push(...added);
        this.notify('images');
      }

      return { addedCount: added.length, skippedCount };
    }

    async loadSamples() {
      const sampleFiles = await generateSampleFiles();
      return this.addFiles(sampleFiles);
    }

    _maybeRevokeUrl(url) {
      const stillUsed = this.state.images.some((item) => item.url === url);
      if (!stillUsed && url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }

    removeImage(id) {
      const idx = this.state.images.findIndex((item) => item.id === id);
      if (idx === -1) return;
      const [removed] = this.state.images.splice(idx, 1);
      if (this.state.selectedImageId === id) {
        this.state.selectedImageId = null;
      }
      this._maybeRevokeUrl(removed.url);
      this.notify('images');
    }

    duplicateImage(id) {
      const idx = this.state.images.findIndex((item) => item.id === id);
      if (idx === -1) return;
      const src = this.state.images[idx];
      const copy = {
        ...src,
        id: `img-${nextIdCounter++}`,
        transforms: {}
      };
      this.state.images.splice(idx + 1, 0, copy);
      this.notify('images');
    }

    async rotateImage(id) {
      const item = this.state.images.find((img) => img.id === id);
      if (!item) return;
      const oldUrl = item.url;
      const rotated = await rotateImageBlobUrl(oldUrl, item.type);
      item.url = rotated.url;
      item.naturalWidth = rotated.width;
      item.naturalHeight = rotated.height;
      item.rotation = (item.rotation + 90) % 360;
      if (item.transforms) {
        Object.keys(item.transforms).forEach((m) => {
          const t = item.transforms[m];
          if (t && t.widthMm !== null && t.heightMm !== null) {
            const oldW = t.widthMm;
            t.widthMm = t.heightMm;
            t.heightMm = oldW;
          }
        });
      }
      this._maybeRevokeUrl(oldUrl);
      this.notify('images');
    }

    moveImage(fromIndex, toIndex) {
      const len = this.state.images.length;
      if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len || fromIndex === toIndex) {
        return;
      }
      const [moved] = this.state.images.splice(fromIndex, 1);
      this.state.images.splice(toIndex, 0, moved);
      this.notify('images');
    }

    reverseImages() {
      if (this.state.images.length < 2) return;
      this.state.images.reverse();
      this.notify('images');
    }

    clearImages() {
      const urls = new Set(this.state.images.map((item) => item.url));
      this.state.images = [];
      this.state.selectedImageId = null;
      urls.forEach((url) => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
      this.notify('images');
    }
  }

  global.EZPrint = global.EZPrint || {};
  global.EZPrint.Store = Store;
})(window);
