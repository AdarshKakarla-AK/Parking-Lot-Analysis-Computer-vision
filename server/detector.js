const ort = require('onnxruntime-node');
const sharp = require('sharp');
const path = require('path');

const MODEL_PATH = path.join(__dirname, '..', 'models', 'yolov10n.onnx');
const INPUT_SIZE = 640;

// COCO vehicle classes
const VEHICLE_CLASSES = new Set([2, 3, 5, 7]);
const CLASS_NAMES = { 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck' };

let sessionPromise = null;
function getSession() {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_PATH, {
      intraOpNumThreads: Math.max(2, Math.min(8, require('os').cpus().length)),
      graphOptimizationLevel: 'all',
    });
  }
  return sessionPromise;
}

/** Decode + letterbox an image (buffer or sharp instance region) into a CHW float tensor. */
async function toTensor(input, size = INPUT_SIZE) {
  const pipeline = sharp(input).rotate();
  const meta = await pipeline.metadata();
  const scale = Math.min(size / meta.width, size / meta.height);
  const nw = Math.max(1, Math.round(meta.width * scale));
  const nh = Math.max(1, Math.round(meta.height * scale));

  const rgb = await pipeline
    .resize(nw, nh, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer();

  const padX = Math.floor((size - nw) / 2);
  const padY = Math.floor((size - nh) / 2);
  const data = new Float32Array(3 * size * size); // zero-filled = black padding

  for (let y = 0; y < nh; y++) {
    const srcRow = y * nw * 3;
    const dstRow = (y + padY) * size;
    for (let x = 0; x < nw; x++) {
      const si = srcRow + x * 3;
      const di = dstRow + x + padX;
      data[di] = rgb[si] / 255;
      data[size * size + di] = rgb[si + 1] / 255;
      data[2 * size * size + di] = rgb[si + 2] / 255;
    }
  }

  return { data, scale, padX, padY, width: meta.width, height: meta.height };
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

function nms(boxes, iouThreshold = 0.5) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep = [];
  for (const box of sorted) {
    if (!keep.some((k) => iou(k, box) > iouThreshold)) keep.push(box);
  }
  return keep;
}

/**
 * Run the detector on a whole image (single pass).
 * Boxes are returned in original image pixel coordinates.
 */
async function detectFull(buffer, session, conf) {
  const t = await toTensor(buffer);
  const tensor = new ort.Tensor('float32', t.data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const out = await session.run({ images: tensor });
  const raw = out.output0.data; // [1, 300, 6] -> x1,y1,x2,y2,score,class
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
    boxes.push({
      x: Math.max(0, x1),
      y: Math.max(0, y1),
      w: Math.min(t.width, x2) - Math.max(0, x1),
      h: Math.min(t.height, y2) - Math.max(0, y1),
      score,
      cls,
      name: CLASS_NAMES[cls],
    });
  }
  return { boxes, width: t.width, height: t.height };
}

/** 2x2 overlapping tiles -> better recall on small/distant vehicles. */
async function detectTiled(buffer, session, conf) {
  const meta = await sharp(buffer).metadata();
  const W = meta.width;
  const H = meta.height;
  const overlap = 0.12;
  const tw = Math.round(W / (2 - overlap));
  const th = Math.round(H / (2 - overlap));
  const xs = [0, W - tw];
  const ys = [0, H - th];
  const all = [];

  for (const ty of ys) {
    for (const tx of xs) {
      const tile = await sharp(buffer)
        .extract({ left: tx, top: ty, width: Math.min(tw, W), height: Math.min(th, H) })
        .toBuffer();
      const t = await toTensor(tile);
      const tensor = new ort.Tensor('float32', t.data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const out = await session.run({ images: tensor });
      const raw = out.output0.data;
      for (let i = 0; i < 300; i++) {
        const o = i * 6;
        const score = raw[o + 4];
        if (score < conf) continue;
        const cls = Math.round(raw[o + 5]);
        if (!VEHICLE_CLASSES.has(cls)) continue;
        const x1 = tx + (raw[o] - t.padX) / t.scale;
        const y1 = ty + (raw[o + 1] - t.padY) / t.scale;
        const x2 = tx + (raw[o + 2] - t.padX) / t.scale;
        const y2 = ty + (raw[o + 3] - t.padY) / t.scale;
        all.push({
          x: Math.max(0, x1),
          y: Math.max(0, y1),
          w: Math.min(W, x2) - Math.max(0, x1),
          h: Math.min(H, y2) - Math.max(0, y1),
          score,
          cls,
          name: CLASS_NAMES[cls],
        });
      }
    }
  }
  return { boxes: nms(all, 0.45), width: W, height: H };
}

/**
 * Detect vehicles. mode: 'auto' | 'full' | 'tiles'
 * Returns { count, boxes, width, height, mode }
 */
async function detect(buffer, { conf = 0.25, mode = 'auto', includeTrucks = true } = {}) {
  const session = await getSession();
  let result;
  if (mode === 'tiles') {
    result = await detectTiled(buffer, session, conf);
  } else if (mode === 'full') {
    result = await detectFull(buffer, session, conf);
  } else {
    // Full pass + tiled pass merged: catches big and small vehicles.
    const [full, tiles] = await Promise.all([
      detectFull(buffer, session, conf),
      detectTiled(buffer, session, conf),
    ]);
    result = { ...full, boxes: nms([...full.boxes, ...tiles.boxes], 0.5) };
  }

  const boxes = includeTrucks
    ? result.boxes
    : result.boxes.filter((b) => b.cls === 2);

  return {
    count: boxes.length,
    boxes: boxes.map((b) => ({
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.w),
      h: Math.round(b.h),
      score: Math.round(b.score * 100) / 100,
      cls: b.cls,
      name: b.name,
    })),
    width: result.width,
    height: result.height,
    mode: mode === 'auto' ? 'full+tiles' : mode,
  };
}

module.exports = { detect, getSession, CLASS_NAMES, VEHICLE_CLASSES };
