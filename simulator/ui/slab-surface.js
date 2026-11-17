/* Material appearance only. Tile coordinates and machine motion are supplied by the viewer. */
(function (global) {
  'use strict';
  const n = value => Math.round(value * 100) / 100;
  const cachedProducts = new WeakMap();
  // The notebook/model's complete-unit placement rule, using only the loaded
  // design. Coordinate-only CSV jobs deliberately get no invented product fill.
  function products(layout) {
    if (!layout || typeof layout !== 'object') return [];
    if (cachedProducts.has(layout)) return cachedProducts.get(layout);
    const explicit = layout.products || layout.polygons || layout.tiles;
    let tiles = [];
    if (Array.isArray(explicit)) {
      tiles = explicit.map(product => {
        const vertices = Array.isArray(product) ? product : product.vertices || product.points || product.polygon;
        if (!Array.isArray(vertices) || vertices.length < 3) return null;
        const points = vertices.map(p => Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);
        return points.every(p => p.every(Number.isFinite)) ? points : null;
      }).filter(Boolean);
    } else {
      const {w, h, theta} = layout.design || {};
      if (Number.isFinite(w) && w >= 1 && w <= 300 && Number.isFinite(h) && h >= 1 && h <= 60 && Number.isFinite(theta) && theta > 0 && theta <= 90) {
        const radians = theta * Math.PI / 180, epsilon = 1e-9;
        const q = Math.abs(Math.cos(radians)) <= 1e-15 ? 0 : 1 / Math.tan(radians);
        for (let row = 0; row < Math.floor((60 + epsilon) / h); row++) {
          const bottom = row * h, top = (row + 1) * h;
          const first = Math.ceil((-epsilon - bottom * q) / w);
          const last = Math.floor((300 + epsilon - w - top * q) / w);
          for (let k = first; k <= last; k++) tiles.push([
            [k * w + bottom * q, bottom], [(k + 1) * w + bottom * q, bottom],
            [(k + 1) * w + top * q, top], [k * w + top * q, top]
          ]);
        }
      }
    }
    cachedProducts.set(layout, tiles);
    return tiles;
  }
  function defs(uid) {
    return `<linearGradient id="rm-slab-holder-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9ecef"/><stop offset="0.45" stop-color="#ced4da"/>
      <stop offset="1" stop-color="#adb5bd"/></linearGradient>
      <linearGradient id="rm-slab-mat-${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f8f9fa"/></linearGradient>
      <pattern id="rm-slab-texture-${uid}" width="9" height="9" patternUnits="userSpaceOnUse">
      <path d="M -2 0 L 7 9 M 7 0 L 16 9" fill="none" stroke="#d0ebff" stroke-width="0.55" opacity="0.18"/>
      <path d="M 0 3 H 9" stroke="#e9ecef" stroke-width="0.4" opacity="0.3"/></pattern>`;
  }
  function bolt(x, y) {
    return `<circle cx="${x}" cy="${y}" r="1.8" fill="#dee2e6" stroke="#868e96" stroke-width="0.65"/>
      <path d="M ${x - 0.8} ${y} H ${x + 0.8}" stroke="#495057" stroke-width="0.6"/>`;
  }
  function render({uid, cx, cy, scale, angle, tiles = [], outlines = true}) {
    let out = `<g data-slab-surface transform="translate(${cx} ${cy}) rotate(${n(angle)}) scale(${scale}) translate(-150 -30)">
      <rect x="-5" y="-2" width="312" height="70" rx="2.5" fill="#212529" opacity="0.14"/>
      <rect x="-8" y="-8" width="316" height="76" rx="2.5" fill="url(#rm-slab-holder-${uid})" stroke="#868e96" stroke-width="0.8"/>
      <rect x="-6" y="-6" width="312" height="72" rx="1.5" fill="#e7f5ff" opacity="0.13"/>
      <path d="M -6 63 V -6 H 306" fill="none" stroke="#f8f9fa" stroke-width="0.8" opacity="0.8"/>
      <rect data-slab-board x="0" y="0" width="300" height="60" rx="1.2" fill="url(#rm-slab-mat-${uid})" stroke="#868e96"/>
      <rect x="0" y="0" width="300" height="60" rx="1.2" fill="#ffffff" opacity="0.12"/>
      <rect x="0" y="0" width="300" height="60" rx="1.2" fill="url(#rm-slab-texture-${uid})"/>`;
    const productPath = tiles.map(tile => 'M ' + tile.map(p => p.map(n).join(' ')).join(' L ') + ' Z').join(' ');
    if (productPath) out += `<path data-slab-products data-product-count="${tiles.length}" d="${productPath}" fill="#e7f5ff" fill-opacity="0.92" stroke="${outlines ? '#74c0fc' : 'none'}" stroke-width="0.7"/>`;
    for (const x of [-8, 301]) {
      out += `<rect x="${x}" y="20" width="7" height="20" rx="1" fill="url(#rm-slab-holder-${uid})" stroke="#868e96" stroke-width="0.6"/>`;
      out += bolt(x + 3.5, 30);
    }
    return out + '</g>';
  }
  global.RiseSlabSurface = {defs, render, products};
})(typeof globalThis !== 'undefined' ? globalThis : this);
