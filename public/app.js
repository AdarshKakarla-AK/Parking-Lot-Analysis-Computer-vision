/* ParkPulse front-end */
(() => {
  const MAX_PHOTOS = 5;
  const PREFS_KEY = 'parkpulse.prefs.v1';

  const $ = (sel) => document.querySelector(sel);
  const els = {
    dropzone: $('#dropzone'),
    dropzoneEmpty: $('#dropzoneEmpty'),
    fileInput: $('#fileInput'),
    slots: $('#slots'),
    photoCounter: $('#photoCounter'),
    browseBtn: $('#browseBtn'),
    sampleBtn: $('#sampleBtn'),
    clearBtn: $('#clearBtn'),
    lowSale: $('#lowSale'),
    highSale: $('#highSale'),
    currency: $('#currency'),
    capacity: $('#capacity'),
    mode: $('#mode'),
    avgSaleValue: $('#avgSaleValue'),
    avgSaleCalc: $('#avgSaleCalc'),
    analyzeBtn: $('#analyzeBtn'),
    analyzeNote: $('#analyzeNote'),
    results: $('#results'),
    reportMeta: $('#reportMeta'),
    kpiTotal: $('#kpiTotal'),
    kpiTotalSub: $('#kpiTotalSub'),
    kpiAvg: $('#kpiAvg'),
    kpiOcc: $('#kpiOcc'),
    kpiOccSub: $('#kpiOccSub'),
    kpiSales: $('#kpiSales'),
    kpiSalesSub: $('#kpiSalesSub'),
    formula: $('#formula'),
    rangeFill: $('#rangeFill'),
    rangeMarker: $('#rangeMarker'),
    rangeLow: $('#rangeLow'),
    rangeMid: $('#rangeMid'),
    rangeHigh: $('#rangeHigh'),
    projWeek: $('#projWeek'),
    projMonth: $('#projMonth'),
    projPhoto: $('#projPhoto'),
    disclaimer: $('#disclaimer'),
    bars: $('#bars'),
    breakdownCount: $('#breakdownCount'),
    gallery: $('#gallery'),
    galleryMeta: $('#galleryMeta'),
    modelStatus: $('#modelStatus'),
    modelStatusText: $('#modelStatusText'),
    lightbox: $('#lightbox'),
    lightboxImg: $('#lightboxImg'),
    lightboxClose: $('#lightboxClose'),
    heroBadge: $('#heroBadge'),
  };

  /** @type {{file: File, url: string, result: any}[]} */
  let slots = [];
  let analysis = null;
  let analyzing = false;
  let sampleLoading = false;

  /* ---------------- helpers ---------------- */

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  function currencySymbol(code) {
    try {
      const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).formatToParts(0);
      return (parts.find((p) => p.type === 'currency') || {}).value || code;
    } catch {
      return code;
    }
  }

  function money(value, code = els.currency.value, digits = 0) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code,
        maximumFractionDigits: digits,
        minimumFractionDigits: 0,
      }).format(value);
    } catch {
      return `${code} ${Math.round(value).toLocaleString()}`;
    }
  }

  function toast(message, kind = 'error') {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.className = `toast toast--${kind}`;
    el.textContent = message;
    clearTimeout(el._timer);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 5200);
  }

  function setAnalyzing(value) {
    analyzing = value;
    els.analyzeBtn.classList.toggle('is-loading', value);
    els.analyzeBtn.disabled = value || slots.length === 0;
    updateAnalyzeNote();
  }

  function updateAnalyzeNote() {
    if (analyzing) {
      els.analyzeNote.textContent = `Scanning ${slots.length} photo${slots.length === 1 ? '' : 's'}…`;
    } else if (!slots.length) {
      els.analyzeNote.textContent = 'Add at least one photo to begin.';
    } else {
      els.analyzeNote.textContent = `${slots.length} photo${slots.length === 1 ? '' : 's'} ready · ${els.mode.value === 'fast' ? 'fast' : els.mode.value === 'accurate' ? 'high accuracy' : 'balanced'} mode`;
    }
  }

  /* ---------------- preferences ---------------- */

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (p.currency) els.currency.value = p.currency;
      if (p.low !== undefined && p.low !== '') els.lowSale.value = p.low;
      if (p.high !== undefined && p.high !== '') els.highSale.value = p.high;
      if (p.capacity !== undefined) els.capacity.value = p.capacity;
      if (p.mode) els.mode.value = p.mode;
    } catch {
      /* ignore */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          currency: els.currency.value,
          low: els.lowSale.value,
          high: els.highSale.value,
          capacity: els.capacity.value,
          mode: els.mode.value,
        })
      );
    } catch {
      /* ignore */
    }
  }

  /* ---------------- slots ---------------- */

  function addFiles(fileList) {
    const incoming = [...fileList].filter((f) => f && f.type.startsWith('image/'));
    if (!incoming.length) return;
    const room = MAX_PHOTOS - slots.length;
    if (room <= 0) {
      toast('You can analyze up to 5 photos at a time.');
      return;
    }
    incoming.slice(0, room).forEach((file) => {
      slots.push({ file, url: URL.createObjectURL(file), result: null });
    });
    if (incoming.length > room) toast(`Only the first ${room} photo${room === 1 ? '' : 's'} were added (max 5).`, 'info');
    resetAnalysis();
    renderSlots();
    updateAnalyzeNote();
  }

  function removeSlot(index) {
    const [removed] = slots.splice(index, 1);
    if (removed?.url) URL.revokeObjectURL(removed.url);
    resetAnalysis();
    renderSlots();
    updateAnalyzeNote();
  }

  function clearAll() {
    slots.forEach((s) => s.url && URL.revokeObjectURL(s.url));
    slots = [];
    els.fileInput.value = '';
    resetAnalysis();
    renderSlots();
    updateAnalyzeNote();
  }

  function resetAnalysis() {
    analysis = null;
    slots.forEach((s) => (s.result = null));
    els.results.hidden = true;
  }

  function renderSlots() {
    els.slots.innerHTML = '';
    for (let i = 0; i < MAX_PHOTOS; i++) {
      const slot = slots[i];
      const el = document.createElement('div');
      el.className = 'slot' + (slot ? ' is-filled' : ' is-empty');

      if (!slot) {
        el.textContent = '+';
        el.title = 'Add a photo';
        el.addEventListener('click', () => els.fileInput.click());
      } else {
        el.innerHTML = `
          <span class="slot__index">${String(i + 1).padStart(2, '0')}</span>
          <img src="${slot.result ? slot.result.thumb : slot.url}" alt="Parking lot photo ${i + 1}" />
          <button class="slot__remove" type="button" aria-label="Remove photo ${i + 1}">×</button>
          ${slot.result ? `<span class="slot__count"><b>${slot.result.count}</b> cars</span>` : ''}
          ${slot.result ? `<span class="slot__conf">${slot.result.avgConfidence}%</span>` : ''}
        `;
        el.querySelector('.slot__remove').addEventListener('click', (e) => {
          e.stopPropagation();
          removeSlot(i);
        });
        el.addEventListener('click', () => {
          if (slot.result) openLightbox(slot.result.thumb);
          else openLightbox(slot.url);
        });
      }
      els.slots.appendChild(el);
    }

    els.dropzone.classList.toggle('has-files', slots.length > 0);
    els.photoCounter.textContent = `${slots.length} / ${MAX_PHOTOS}`;
    els.analyzeBtn.disabled = analyzing || slots.length === 0;
    updateAnalyzeNote();
  }

  /* ---------------- pricing ---------------- */

  function priceValues() {
    const low = num(els.lowSale.value);
    const high = num(els.highSale.value);
    return { low: Math.min(low, high), high: Math.max(low, high) };
  }

  function updateAvgCard() {
    const { low, high } = priceValues();
    const avg = (low + high) / 2;
    els.avgSaleValue.textContent = money(avg, els.currency.value, avg % 1 === 0 ? 0 : 2);
    els.avgSaleCalc.textContent = `(${money(low, els.currency.value)} + ${money(high, els.currency.value)}) ÷ 2`;
    const sym = currencySymbol(els.currency.value);
    document.querySelectorAll('[data-currency-symbol]').forEach((el) => (el.textContent = sym));
  }

  /* ---------------- analysis request ---------------- */

  /** Normalize backend or client result into the same shape the UI expects. */
  function normalizeResult(img, i) {
    return {
      name: img.name || `Photo ${i + 1}`,
      count: img.count,
      width: img.width,
      height: img.height,
      boxes: img.boxes || [],
      avgConfidence: img.avgConfidence != null ? img.avgConfidence : 0,
      inferenceMs: img.inferenceMs || 0,
      thumb: img.thumb,
      mode: img.mode || 'client',
    };
  }

  /** Client-side detection via ONNX Runtime Web (no backend needed). */
  async function clientAnalyze() {
    const modeMap = { fast: { conf: 0.12, mode: 'fast' }, balanced: { conf: 0.12, mode: 'full' }, accurate: { conf: 0.08, mode: 'accurate' } };
    const params = modeMap[els.mode.value] || modeMap.balanced;
    const results = [];
    for (let i = 0; i < slots.length; i++) {
      const res = await ParkPulseDetector.detectAnnotated(slots[i].file, params);
      results.push(normalizeResult(res, i));
      slots[i].result = results[i];
      renderSlots();
    }
    return { ok: true, images: results, summary: buildSummary(results), mode: params.mode, confidenceThreshold: params.conf };
  }

  function buildSummary(images) {
    const counts = images.map((r) => r.count);
    const total = counts.reduce((a, b) => a + b, 0);
    const average = total / counts.length;
    const sorted = [...counts].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return {
      photos: images.length, total,
      average: Math.round(average * 10) / 10,
      median, min: sorted[0], max: sorted[sorted.length - 1],
      mode: images[0]?.mode || 'client', confidenceThreshold: images[0]?.avgConfidence ? 0.12 : 0.12,
    };
  }

  async function analyze() {
    if (analyzing || !slots.length) return;
    setAnalyzing(true);
    els.analyzeBtn.classList.add('is-loading');
    els.slots.querySelectorAll('.slot').forEach((s) => s.classList.add('is-loading'));

    let usedBackend = false;
    try {
      // 1) Try a backend first (local dev). Falls through to client on 404 / offline (Cloudflare Pages).
      const health = await fetch('/api/health', { method: 'GET', signal: AbortSignal.timeout(2500) }).catch(() => null);
      if (health && health.ok) {
        const fd = new FormData();
        slots.forEach((s) => fd.append('images', s.file, s.file.name));
        fd.append('mode', els.mode.value);
        const res = await fetch('/api/analyze', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `Analysis failed (${res.status}).`);
        data.images.forEach((img, i) => { if (slots[i]) slots[i].result = normalizeResult(img, i); });
        usedBackend = true;
        analysis = data;
      } else {
        throw new Error('no backend');
      }
    } catch (backendErr) {
      // 2) Client-side fallback (works on Cloudflare Pages / static hosting).
      try {
        const data = await clientAnalyze();
        analysis = data;
      } catch (clientErr) {
        toast(clientErr.message || 'Client detection failed. Did the model load?');
        resetAnalysis();
        els.analyzeBtn.classList.remove('is-loading');
        setAnalyzing(false);
        els.slots.querySelectorAll('.slot').forEach((s) => s.classList.remove('is-loading'));
        return;
      }
    }

    renderSlots();
    renderResults();
    els.results.hidden = false;
    updateAnalyzeNote();
    requestAnimationFrame(() => els.results.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    els.analyzeBtn.classList.remove('is-loading');
    setAnalyzing(false);
    els.slots.querySelectorAll('.slot').forEach((s) => s.classList.remove('is-loading'));
    if (!usedBackend) toast('Running client-side detection (no backend).', 'info');
  }

  /* ---------------- results ---------------- */

  function renderResults() {
    if (!analysis || !slots.length) return;
    const images = analysis.images;
    const summary = analysis.summary;
    const { low, high } = priceValues();
    const avgSale = (low + high) / 2;
    const avgCars = summary.average;
    const expected = avgCars * avgSale;
    const conservative = avgCars * low;
    const optimistic = avgCars * high;
    const currency = els.currency.value;
    const capacity = num(els.capacity.value);

    // KPI cards
    els.kpiTotal.textContent = summary.total.toLocaleString();
    els.kpiTotalSub.textContent = `across ${summary.photos} photo${summary.photos === 1 ? '' : 's'} · ${summary.min}–${summary.max} per photo`;
    els.kpiAvg.textContent = summary.average.toLocaleString(undefined, { maximumFractionDigits: 1 });
    els.kpiSales.textContent = money(expected, currency);
    els.kpiSalesSub.textContent = `${summary.average.toLocaleString(undefined, { maximumFractionDigits: 1 })} cars × ${money(avgSale, currency)} per car`;

    if (capacity > 0) {
      const occ = (avgCars / capacity) * 100;
      els.kpiOcc.textContent = `${occ.toFixed(occ >= 10 ? 0 : 1)}%`;
      els.kpiOccSub.textContent = `~${Math.round(avgCars)} of ${capacity.toLocaleString()} spaces used`;
    } else {
      els.kpiOcc.textContent = '—';
      els.kpiOccSub.textContent = 'add lot capacity to see';
    }

    // report meta
    const modeLabel = summary.mode === 'fast' ? 'Fast' : summary.mode === 'accurate' ? 'High accuracy' : 'Balanced';
    const now = new Date();
    els.reportMeta.textContent = `${now.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} · ${summary.photos} photos · ${modeLabel} · conf ${summary.confidenceThreshold}`;

    // formula
    els.formula.innerHTML = `
      <div class="formula__row"><span>Total cars detected</span><span>${summary.total} cars</span></div>
      <div class="formula__row"><span>Average footfall per photo</span><span>${summary.total} ÷ ${summary.photos} = <b>${summary.average.toLocaleString(undefined, { maximumFractionDigits: 1 })} cars</b></span></div>
      <div class="formula__row"><span>Average sale per car</span><span>(${money(low, currency)} + ${money(high, currency)}) ÷ 2 = <b>${money(avgSale, currency)}</b></span></div>
      <div class="formula__row formula__row--total"><span>Estimated day's sales</span><span>${summary.average.toLocaleString(undefined, { maximumFractionDigits: 1 })} × ${money(avgSale, currency)} = ${money(expected, currency)}</span></div>
    `;

    // range
    els.rangeLow.textContent = money(conservative, currency);
    els.rangeMid.textContent = money(expected, currency);
    els.rangeHigh.textContent = money(optimistic, currency);
    const markerPct = optimistic > conservative ? 50 : 50;
    els.rangeMarker.style.left = `${markerPct}%`;

    // projections
    els.projWeek.textContent = money(expected * 7, currency);
    els.projMonth.textContent = money(expected * 30, currency);
    els.projPhoto.textContent = money(avgSale, currency);

    els.disclaimer.textContent = `Assumes every parked car generates the average sale (${money(avgSale, currency)}). Real revenue changes with dwell time, hourly turnover, free/validated parking and the mix of vehicles.${summary.photos < 5 ? ' Add more photos for a steadier average.' : ''}`;

    // bars
    const maxCount = Math.max(1, ...images.map((i) => i.count));
    els.bars.innerHTML = '';
    images.forEach((img, i) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `
        <span class="bar-row__label">P${i + 1}</span>
        <span class="bar-row__track"><span class="bar-row__fill"></span></span>
        <span class="bar-row__value">${img.count}</span>
      `;
      els.bars.appendChild(row);
      const fill = row.querySelector('.bar-row__fill');
      fill.classList.toggle('is-avg', img.count >= avgCars);
      requestAnimationFrame(() => (fill.style.width = `${Math.max(4, (img.count / maxCount) * 100)}%`));
    });
    els.breakdownCount.textContent = `${summary.total} cars total`;
    if (summary.photos > 1) {
      const note = document.createElement('div');
      note.className = 'bar-row';
      note.style.cssText = 'grid-template-columns:34px 1fr 44px;opacity:.85';
      note.innerHTML = `<span class="bar-row__label" style="color:var(--accent)">AVG</span><span class="bar-row__track" style="background:none;border-top:1px dashed rgba(52,227,154,.45);height:11px;border-radius:0"></span><span class="bar-row__value">${summary.average.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>`;
      els.bars.appendChild(note);
    }

    // gallery
    els.gallery.innerHTML = '';
    images.forEach((img, i) => {
      const fig = document.createElement('figure');
      fig.innerHTML = `
        <img src="${img.thumb}" alt="Annotated photo ${i + 1}: ${img.count} cars detected" loading="lazy" />
        <figcaption><span>P${i + 1} · <b>${img.count}</b></span><span class="conf">${img.avgConfidence}%</span></figcaption>
      `;
      fig.addEventListener('click', () => openLightbox(img.thumb));
      els.gallery.appendChild(fig);
    });
    els.galleryMeta.textContent = `${images.length} annotated photo${images.length === 1 ? '' : 's'}`;

    els.heroBadge.textContent = `${summary.average.toLocaleString(undefined, { maximumFractionDigits: 0 })} cars avg`;
  }

  /* ---------------- lightbox ---------------- */

  function openLightbox(src) {
    els.lightboxImg.src = src;
    els.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lightboxImg.removeAttribute('src');
    document.body.style.overflow = '';
  }

  /* ---------------- events ---------------- */

  els.browseBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => {
    addFiles(e.target.files);
    els.fileInput.value = '';
  });

  els.dropzone.addEventListener('click', (e) => {
    if (e.target.closest('.slot__remove') || e.target.closest('.slot.is-filled')) return;
    if (!slots.length || e.target === els.dropzoneEmpty || els.dropzoneEmpty.contains(e.target)) els.fileInput.click();
  });
  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.add('is-drag');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (evt === 'dragleave' && els.dropzone.contains(e.relatedTarget)) return;
      els.dropzone.classList.remove('is-drag');
    })
  );
  els.dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  els.clearBtn.addEventListener('click', clearAll);

  els.sampleBtn.addEventListener('click', async () => {
    if (sampleLoading) return;
    sampleLoading = true;
    const original = els.sampleBtn.textContent;
    els.sampleBtn.textContent = 'Loading demo…';
    els.sampleBtn.disabled = true;
    try {
      clearAll();
      const files = await Promise.all(
        [1, 2, 3, 4, 5].map(async (n) => {
          const res = await fetch(`samples/sample-${n}.jpg`);
          if (!res.ok) throw new Error('Demo images are missing.');
          const blob = await res.blob();
          return new File([blob], `demo-lot-${n}.jpg`, { type: 'image/jpeg' });
        })
      );
      addFiles(files);
      toast('Demo lot loaded — 5 photos ready.', 'info');
    } catch (err) {
      toast(err.message || 'Could not load the demo lot.');
    } finally {
      els.sampleBtn.textContent = original;
      els.sampleBtn.disabled = false;
      sampleLoading = false;
    }
  });

  els.analyzeBtn.addEventListener('click', analyze);

  [els.lowSale, els.highSale, els.currency, els.capacity, els.mode].forEach((input) => {
    input.addEventListener('input', () => {
      updateAvgCard();
      savePrefs();
      if (analysis) renderResults();
      updateAnalyzeNote();
    });
    input.addEventListener('change', () => {
      updateAvgCard();
      savePrefs();
      if (analysis) renderResults();
      updateAnalyzeNote();
    });
  });

  els.lightboxClose.addEventListener('click', closeLightbox);
  els.lightbox.addEventListener('click', (e) => {
    if (e.target === els.lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.lightbox.hidden) closeLightbox();
  });

  /* ---------------- init ---------------- */

  loadPrefs();
  updateAvgCard();
  renderSlots();
  updateAnalyzeNote();

  fetch('/api/health', { signal: AbortSignal.timeout(2500) })
    .then((r) => r.json())
    .then((data) => {
      els.modelStatus.classList.add(data.ok ? 'is-ok' : 'is-err');
      els.modelStatusText.textContent = data.ok ? 'Backend + vision model ready' : 'Model offline';
    })
    .catch(() => {
      els.modelStatus.classList.add('is-ok');
      els.modelStatusText.textContent = 'Client-side detection ready';
    });
})();
