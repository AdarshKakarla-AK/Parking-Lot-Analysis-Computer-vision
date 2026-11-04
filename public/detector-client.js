/* ParkPulse client-side detector (TensorFlow.js + COCO-SSD) — runs in the browser. */
(() => {
  const VEHICLE_CLASSES = new Set(['car', 'motorcycle', 'bus', 'truck']);
  let model = null;
  let loadPromise = null;
  let lastError = null;

  async function loadModel() {
    if (model) return model;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const tf = await import('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.18.0/dist/tf-core.min.js');
          await import('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
          const cocoSsd = window.cocoSsd;
          if (!cocoSsd) throw new Error('coco-ssd failed to load');
          model = await cocoSsd.load();
          return model;
        } catch (e) {
          lastError = e;
          throw e;
        }
      })();
    }
    return loadPromise;
  }

  async function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = file instanceof File ? URL.createObjectURL(file) : file;
    });
  }

  function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - inter;
    return union <= 0 ? 0 : inter / union;
  }

  function nms(boxes, th = 0.45) {
    const s = [...boxes].sort((a, b) => b.score - a.score), keep = [];
    for (const b of s) if (!keep.some(k => iou(k, b) > th)) keep.push(b);
    return keep;
  }

  async function detect(bufferOrFile, { conf = 0.4, mode = 'balanced' } = {}) {
    const m = await loadModel();
    const file = bufferOrFile instanceof File ? bufferOrFile : new File([bufferOrFile], 'img.jpg', { type: 'image/jpeg' });
    const img = await loadImage(file);
    const predictions = await m.detect(img);
    const boxes = predictions
      .filter(p => VEHICLE_CLASSES.has(p.class) && p.score >= conf)
      .map(p => ({
        x: Math.max(0, p.bbox[0]),
        y: Math.max(0, p.bbox[1]),
        w: Math.max(0, p.bbox[2]),
        h: Math.max(0, p.bbox[3]),
        score: Math.round(p.score * 100) / 100,
        cls: 2,
        name: p.class,
      }));
    return {
      count: boxes.length,
      boxes: nms(boxes),
      width: img.width,
      height: img.height,
      mode: 'coco-ssd',
    };
  }

  async function detectAnnotated(file, { conf = 0.4, mode = 'balanced' } = {}) {
    const result = await detect(file, { conf, mode });
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = result.width; canvas.height = result.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const scale = Math.min(1, 1000 / Math.max(result.width, result.height));
    const stroke = Math.max(1.6, 2.4 / scale);
    ctx.strokeStyle = '#34e39a'; ctx.lineWidth = stroke; ctx.lineJoin = 'round';
    ctx.font = `${Math.max(10, 12 / scale)}px monospace`; ctx.fillStyle = '#34e39a';
    for (const b of result.boxes) {
      ctx.strokeRect(b.x + 1, b.y + 1, Math.max(2, b.w - 2), Math.max(2, b.h - 2));
      ctx.fillText(`${b.name} ${Math.round(b.score * 100)}%`, b.x + 3, b.y + 12);
    }
    return { ...result, thumb: canvas.toDataURL('image/jpeg', 0.8) };
  }

  window.ParkPulseDetector = { detect, detectAnnotated, loadModel, lastError };
})();
