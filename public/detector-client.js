/* ParkPulse client-side detector (ONNX Runtime Web) — runs in the browser. */
(() => {
  const MODEL_URL = '/models/yolov10n.onnx';
  const INPUT_SIZE = 640;
  const VEHICLE_CLASSES = new Set([2, 3, 5, 7]); // car, motorcycle, bus, truck
  const CLASS_NAMES = { 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck' };

  let session = null;
  let loadPromise = null;

  function loadOrtScript() {
    return new Promise((resolve, reject) => {
      if (window.ort && window.ort.InferenceSession) return resolve(window.ort);
      const existing = document.querySelector('script[src*="onnxruntime-web"]');
      if (existing) {
        existing.onload = () => resolve(window.ort);
        existing.onerror = () => reject(new Error('Failed to load onnxruntime-web'));
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js';
      s.onload = () => {
        if (!window.ort || !window.ort.InferenceSession) {
          reject(new Error('onnxruntime-web loaded but InferenceSession is missing'));
          return;
        }
        resolve(window.ort);
      };
      s.onerror = () => reject(new Error('Failed to load onnxruntime-web from CDN'));
      document.head.appendChild(s);
    });
  }

  async function loadSession() {
    if (session) return session;
    if (!loadPromise) {
      loadPromise = (async () => {
        await loadOrtScript();
        session = await window.ort.InferenceSession.create(MODEL_URL, {
          executionProviders: ['webgl', 'wasm'],
        });
        return session;
      })();
    }
    return loadPromise;
  }

  async function toTensor(file, size = INPUT_SIZE) {
    const img = await loadImage(file);
    const { width, height } = img;
    const scale = Math.min(size / width, size / height);
    const nw = Math.max(1, Math.round(width * scale));
    const nh = Math.max(1, Math.round(height * scale));
    const padX = Math.floor((size - nw) / 2);
    const padY = Math.floor((size - nh) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, padX, padY, nw, nh);

    const data = ctx.getImageData(0, 0, size, size).data;
    const tensor = new Float32Array(3 * size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        tensor[y * size + x] = data[i] / 255;
        tensor[size * size + y * size + x] = data[i + 1] / 255;
        tensor[2 * size * size + y * size + x] = data[i + 2] / 255;
      }
    }
    return { tensor, scale, padX, padY, width, height };
  }

  function loadImage(file) {
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

  function nms(boxes, th = 0.5) {
    const s = [...boxes].sort((a, b) => b.score - a.score), keep = [];
    for (const b of s) if (!keep.some(k => iou(k, b) > th)) keep.push(b);
    return keep;
  }

  async function runOnTensor(t, conf) {
    const s = await loadSession();
    const input = new window.ort.Tensor('float32', t.tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const out = await s.run({ images: input });
    const raw = out.output0.data; // [1, 300, 6]
    const boxes = [];
    for (let i = 0; i < 300; i++) {
      const o = i * 6;
      const score = raw[o + 4];
      if (score < conf) continue;
      const cls = Math.round(raw[o + 5]);
      if (!VEHICLE_CLASSES.has(cls)) continue;
      const x1 = (raw[o] - t.padX) / t.scale;
      const y1 = (raw[o + 1] - t.padY) / t.scale;
      const x2 = (raw[o + 2] - t.padX) / t.scale;
      const y2 = (raw[o + 3] - t.padY) / t.scale;
      boxes.push({ x: Math.max(0, x1), y: Math.max(0, y1), w: Math.min(t.width, x2) - Math.max(0, x1), h: Math.min(t.height, y2) - Math.max(0, y1), score, cls, name: CLASS_NAMES[cls] });
    }
    return { boxes: nms(boxes, 0.5), width: t.width, height: t.height };
  }

  async function detect(bufferOrFile, { conf = 0.12, mode = 'full' } = {}) {
    const file = bufferOrFile instanceof File ? bufferOrFile : new File([bufferOrFile], 'img.jpg', { type: 'image/jpeg' });
    const t = await toTensor(file);
    const result = await runOnTensor(t, conf);
    return {
      count: result.boxes.length,
      boxes: result.boxes.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), score: Math.round(b.score * 100) / 100, cls: b.cls, name: b.name })),
      width: result.width, height: result.height, mode: mode === 'accurate' ? 'full+tiles' : mode
    };
  }

  async function detectAnnotated(file, { conf = 0.12, mode = 'full' } = {}) {
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

  window.ParkPulseDetector = { detect, detectAnnotated, loadSession };
})();
