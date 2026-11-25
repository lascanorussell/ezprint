/* ==========================================================================
   EZ-Print Constants & Unit Helpers
   ========================================================================== */
(function (global) {
  'use strict';

  const MM_PER_INCH = 25.4;
  const CSS_PX_PER_INCH = 96;
  const CSS_PX_PER_MM = CSS_PX_PER_INCH / MM_PER_INCH; // ~3.779527559

  const PAPER_SIZES = {
    a4: { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
    letter: { id: 'letter', label: 'US Letter', widthMm: 215.9, heightMm: 279.4 },
    folio: { id: 'folio', label: 'Folio', widthMm: 203.2, heightMm: 330.2 },
    legal: { id: 'legal', label: 'US Legal', widthMm: 215.9, heightMm: 355.6 },
    a3: { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
    a5: { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210 },
    'photo-4x6': { id: 'photo-4x6', label: 'Photo 4×6"', widthMm: 101.6, heightMm: 152.4 },
    'photo-5x7': { id: 'photo-5x7', label: 'Photo 5×7"', widthMm: 127, heightMm: 177.8 }
  };

  const SUPPORTED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]);

  const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|gif|webp)$/i;

  const ALIGN_MAP = {
    'top-left': { alignItems: 'flex-start', justifyContent: 'flex-start' },
    'top-center': { alignItems: 'flex-start', justifyContent: 'center' },
    'top-right': { alignItems: 'flex-start', justifyContent: 'flex-end' },
    'center-left': { alignItems: 'center', justifyContent: 'flex-start' },
    'center-center': { alignItems: 'center', justifyContent: 'center' },
    'center-right': { alignItems: 'center', justifyContent: 'flex-end' },
    'bottom-left': { alignItems: 'flex-end', justifyContent: 'flex-start' },
    'bottom-center': { alignItems: 'flex-end', justifyContent: 'center' },
    'bottom-right': { alignItems: 'flex-end', justifyContent: 'flex-end' }
  };

  function mmToUnit(mm, unit) {
    if (unit === 'in') {
      return mm / MM_PER_INCH;
    }
    return mm;
  }

  function unitToMm(val, unit) {
    if (unit === 'in') {
      return val * MM_PER_INCH;
    }
    return val;
  }

  function formatUnitValue(mm, unit) {
    if (unit === 'in') {
      return Number((mm / MM_PER_INCH).toFixed(2)).toString();
    }
    return Number(mm.toFixed(1)).toString();
  }

  function formatDimensions(wMm, hMm, unit) {
    if (unit === 'in') {
      const w = (wMm / MM_PER_INCH).toFixed(2).replace(/\.00$/, '');
      const h = (hMm / MM_PER_INCH).toFixed(2).replace(/\.00$/, '');
      return `${w} × ${h} in`;
    }
    const w = Math.round(wMm * 10) / 10;
    const h = Math.round(hMm * 10) / 10;
    return `${w} × ${h} mm`;
  }

  function isSupportedImageFile(file) {
    if (!file) return false;
    if (file.type && SUPPORTED_MIME_TYPES.has(file.type.toLowerCase())) {
      return true;
    }
    return Boolean(file.name && SUPPORTED_EXTENSIONS.test(file.name));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  global.EZPrint = global.EZPrint || {};
  global.EZPrint.Constants = {
    MM_PER_INCH,
    CSS_PX_PER_INCH,
    CSS_PX_PER_MM,
    PAPER_SIZES,
    SUPPORTED_MIME_TYPES,
    SUPPORTED_EXTENSIONS,
    ALIGN_MAP,
    mmToUnit,
    unitToMm,
    formatUnitValue,
    formatDimensions,
    isSupportedImageFile,
    clamp
  };
})(window);
