/* ==========================================================================
   EZ-Print Layout Calculation Engine
   Computes exact page dimensions, optimal single-page grid, pagination,
   and per-photo physical geometry (including Free Transform overrides).
   ========================================================================== */
(function (global) {
  'use strict';

  const { PAPER_SIZES, MM_PER_INCH, ALIGN_MAP, clamp } = global.EZPrint.Constants;

  function getPageMetrics(state) {
    let paperLabel;
    let pageWidthMm;
    let pageHeightMm;
    let orientation = state.orientation;

    if (state.paperSize === 'custom') {
      paperLabel = 'Custom';
      pageWidthMm = clamp(Number(state.customPaperWidthMm) || 210, 30, 1200);
      pageHeightMm = clamp(Number(state.customPaperHeightMm) || 297, 30, 1200);
      orientation = pageWidthMm > pageHeightMm ? 'landscape' : 'portrait';
    } else {
      const base = PAPER_SIZES[state.paperSize] || PAPER_SIZES.a4;
      const isLandscape = state.orientation === 'landscape';
      paperLabel = base.label;
      pageWidthMm = isLandscape ? base.heightMm : base.widthMm;
      pageHeightMm = isLandscape ? base.widthMm : base.heightMm;
    }

    // Ensure margin never exceeds 42% of the smaller page dimension
    const maxSafeMargin = Math.floor(Math.min(pageWidthMm, pageHeightMm) * 0.42);
    const marginMm = clamp(state.marginMm, 0, maxSafeMargin);
    const printableWidthMm = Math.max(10, pageWidthMm - marginMm * 2);
    const printableHeightMm = Math.max(10, pageHeightMm - marginMm * 2);

    return {
      paperLabel,
      orientation,
      pageWidthMm,
      pageHeightMm,
      marginMm,
      printableWidthMm,
      printableHeightMm
    };
  }

  /**
   * Computes fitted width/height preserving natural aspect ratio inside (boxW x boxH).
   */
  function fitAspect(naturalW, naturalH, boxW, boxH) {
    const imgAspect = Math.max(1, naturalW) / Math.max(1, naturalH);
    const boxAspect = Math.max(0.01, boxW) / Math.max(0.01, boxH);
    if (boxAspect > imgAspect) {
      return { w: boxH * imgAspect, h: boxH };
    }
    return { w: boxW, h: boxW / imgAspect };
  }

  /**
   * Combines an image's automatic base rectangle (in mm relative to printable area)
   * with its optional per-mode Free Transform override.
   */
  function applyTransform(image, mode, baseRect, baseFit) {
    const t = image.transforms && image.transforms[mode] ? image.transforms[mode] : null;
    const hasCustomSize = Boolean(t && t.widthMm !== null && t.widthMm !== undefined && t.heightMm !== null && t.heightMm !== undefined);
    const dxMm = t ? t.xMm || 0 : 0;
    const dyMm = t ? t.yMm || 0 : 0;
    const angle = t ? t.angle || 0 : 0;
    const zIndex = t && t.zIndex ? t.zIndex : 1;

    const widthMm = hasCustomSize ? t.widthMm : baseRect.w;
    const heightMm = hasCustomSize ? t.heightMm : baseRect.h;
    const cxMm = baseRect.cx + dxMm;
    const cyMm = baseRect.cy + dyMm;
    const leftMm = cxMm - widthMm / 2;
    const topMm = cyMm - heightMm / 2;

    const isTransformed =
      hasCustomSize || Math.abs(dxMm) > 0.01 || Math.abs(dyMm) > 0.01 || Math.abs(angle) > 0.01;

    // When resized manually via edge/corner handles, let the image fill the user's box
    // (preserving cover crop when the mode itself is Fill/Cover).
    const objectFit = hasCustomSize ? (baseFit === 'cover' ? 'cover' : 'fill') : baseFit;

    return {
      image,
      baseRect,
      leftMm,
      topMm,
      widthMm,
      heightMm,
      cxMm,
      cyMm,
      dxMm,
      dyMm,
      angle,
      zIndex,
      isTransformed,
      hasCustomSize,
      objectFit
    };
  }

  /**
   * Computes an optimal (rows, cols) grid for fitting N images onto one page,
   * maximizing image scale relative to printable area and average image aspect ratio.
   */
  function computeOptimalSinglePageGrid(images, printableW, printableH, gapMm) {
    const count = images.length;
    if (count <= 0) return { rows: 1, cols: 1 };
    if (count === 1) return { rows: 1, cols: 1 };

    const avgAspect =
      images.reduce((sum, img) => sum + img.naturalWidth / Math.max(1, img.naturalHeight), 0) / count;

    let best = { rows: 1, cols: count, score: -Infinity };

    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const cellW = (printableW - gapMm * (cols - 1)) / cols;
      const cellH = (printableH - gapMm * (rows - 1)) / rows;
      if (cellW <= 2 || cellH <= 2) continue;

      const cellAspect = cellW / cellH;
      const fitW = cellAspect > avgAspect ? cellH * avgAspect : cellW;
      const fitH = cellAspect > avgAspect ? cellH : cellW / avgAspect;
      const renderedArea = fitW * fitH;

      const emptySlots = rows * cols - count;
      const wastePenalty = 1 - (emptySlots / (rows * cols)) * 0.14;
      const score = renderedArea * wastePenalty;

      if (score > best.score) {
        best = { rows, cols, score };
      }
    }

    return { rows: best.rows, cols: best.cols };
  }

  function buildGridItems(slice, rows, cols, gapMm, cellFit, metrics, showCaptions, mode) {
    const cellW = Math.max(4, (metrics.printableWidthMm - gapMm * (cols - 1)) / cols);
    const cellH = Math.max(4, (metrics.printableHeightMm - gapMm * (rows - 1)) / rows);
    const captionH = showCaptions ? 4.8 : 0;
    const mediaH = Math.max(4, cellH - captionH);

    return slice.map((img, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const cellX = c * (cellW + gapMm);
      const cellY = r * (cellH + gapMm);

      let w = cellW;
      let h = mediaH;
      if (cellFit === 'contain') {
        const fitted = fitAspect(img.naturalWidth, img.naturalHeight, cellW, mediaH);
        w = fitted.w;
        h = fitted.h;
      }

      const baseRect = {
        cx: cellX + cellW / 2,
        cy: cellY + mediaH / 2,
        w,
        h
      };

      return applyTransform(img, mode, baseRect, cellFit);
    });
  }

  /**
   * Builds the complete print plan consumed by the preview & print DOM renderer.
   */
  function computeLayoutPlan(state) {
    const metrics = getPageMetrics(state);
    const images = state.images;
    const showCaptions = Boolean(state.output && state.output.showCaptions);
    const sheets = [];

    if (images.length === 0) {
      return {
        metrics,
        layoutMode: state.layoutMode,
        sheets: [],
        effectiveAllOnOne: { rows: state.allOnOne.rows, cols: state.allOnOne.cols },
        centerOverflowCount: 0,
        itemsById: {}
      };
    }

    let centerOverflowCount = 0;
    let effectiveAllOnOne = {
      rows: state.allOnOne.rows,
      cols: state.allOnOne.cols
    };
    const itemsById = {};

    if (state.layoutMode === 'one-per-page') {
      const cfg = state.onePerPage;
      const align = ALIGN_MAP[cfg.freeformAlign] || ALIGN_MAP['center-center'];
      const stageW = metrics.printableWidthMm;
      const captionH = showCaptions ? 6.2 : 0;
      const stageH = Math.max(10, metrics.printableHeightMm - captionH);

      images.forEach((img, index) => {
        const naturalWidthMm = (img.naturalWidth / cfg.centerDpi) * MM_PER_INCH;
        const naturalHeightMm = (img.naturalHeight / cfg.centerDpi) * MM_PER_INCH;

        if (
          cfg.sizing === 'center' &&
          (naturalWidthMm > metrics.printableWidthMm + 0.5 || naturalHeightMm > metrics.printableHeightMm + 0.5)
        ) {
          centerOverflowCount += 1;
        }

        let baseRect;
        let baseFit = 'contain';

        if (cfg.sizing === 'best-fit') {
          const fitted = fitAspect(img.naturalWidth, img.naturalHeight, stageW, stageH);
          baseRect = { cx: stageW / 2, cy: stageH / 2, w: fitted.w, h: fitted.h };
          baseFit = 'contain';
        } else if (cfg.sizing === 'stretch') {
          baseRect = { cx: stageW / 2, cy: stageH / 2, w: stageW, h: stageH };
          baseFit = 'fill';
        } else if (cfg.sizing === 'center') {
          baseRect = { cx: stageW / 2, cy: stageH / 2, w: naturalWidthMm, h: naturalHeightMm };
          baseFit = 'fill';
        } else {
          // freeform
          let w = cfg.freeformWidthMm;
          let h = cfg.freeformHeightMm;
          let left = (stageW - w) / 2;
          let top = (stageH - h) / 2;

          if (align.justifyContent === 'flex-start') left = 0;
          else if (align.justifyContent === 'flex-end') left = stageW - w;

          if (align.alignItems === 'flex-start') top = 0;
          else if (align.alignItems === 'flex-end') top = stageH - h;

          baseRect = { cx: left + w / 2, cy: top + h / 2, w, h };
          baseFit = cfg.freeformFit || 'contain';
        }

        const item = applyTransform(img, 'one-per-page', baseRect, baseFit);
        itemsById[img.id] = { sheetIndex: index, item };

        sheets.push({
          pageNumber: index + 1,
          mode: 'one-per-page',
          sizing: cfg.sizing,
          image: img,
          items: [item]
        });
      });
    } else if (state.layoutMode === 'custom-grid') {
      const rows = clamp(state.customGrid.rows, 1, 12);
      const cols = clamp(state.customGrid.cols, 1, 12);
      const perPage = rows * cols;
      const totalPages = Math.ceil(images.length / perPage);

      for (let p = 0; p < totalPages; p++) {
        const slice = images.slice(p * perPage, (p + 1) * perPage);
        const items = buildGridItems(
          slice,
          rows,
          cols,
          state.customGrid.gapMm,
          state.customGrid.cellFit,
          metrics,
          showCaptions,
          'custom-grid'
        );
        items.forEach((item) => {
          itemsById[item.image.id] = { sheetIndex: p, item };
        });

        sheets.push({
          pageNumber: p + 1,
          mode: 'grid',
          rows,
          cols,
          gapMm: state.customGrid.gapMm,
          cellFit: state.customGrid.cellFit,
          images: slice,
          items
        });
      }
    } else if (state.layoutMode === 'all-on-one') {
      let rows = state.allOnOne.rows;
      let cols = state.allOnOne.cols;

      if (state.allOnOne.autoGrid) {
        const optimal = computeOptimalSinglePageGrid(
          images,
          metrics.printableWidthMm,
          metrics.printableHeightMm,
          state.allOnOne.gapMm
        );
        rows = optimal.rows;
        cols = optimal.cols;
      } else if (rows * cols < images.length) {
        rows = Math.ceil(images.length / cols);
      }

      effectiveAllOnOne = { rows, cols };

      const items = buildGridItems(
        images,
        rows,
        cols,
        state.allOnOne.gapMm,
        state.allOnOne.cellFit,
        metrics,
        showCaptions,
        'all-on-one'
      );
      items.forEach((item) => {
        itemsById[item.image.id] = { sheetIndex: 0, item };
      });

      sheets.push({
        pageNumber: 1,
        mode: 'grid',
        rows,
        cols,
        gapMm: state.allOnOne.gapMm,
        cellFit: state.allOnOne.cellFit,
        images: images.slice(),
        items
      });
    }

    return {
      metrics,
      layoutMode: state.layoutMode,
      sheets,
      effectiveAllOnOne,
      centerOverflowCount,
      itemsById
    };
  }

  global.EZPrint = global.EZPrint || {};
  global.EZPrint.Layout = {
    getPageMetrics,
    fitAspect,
    computeOptimalSinglePageGrid,
    computeLayoutPlan
  };
})(window);
