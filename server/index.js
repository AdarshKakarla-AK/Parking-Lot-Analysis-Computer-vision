const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const { detect, getSession } = require('./detector');

const app = express();
const PORT = process.env.PORT || 9090;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|avif|bmp)$/i.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, WebP, AVIF or BMP images are supported.'));
  },
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '1mb' }));

// Draw detection boxes onto the image so the user can verify the count.
async function annotatedPreview(buffer, result) {
  const { width, height, boxes } = result;
  const scale = Math.min(1, 1000 / Math.max(width, height));
  const stroke = Math.max(1.6, 2.4 / scale);
  const rects = boxes
    .map(
      (b) =>
        `<rect x="${b.x + 1}" y="${b.y + 1}" width="${Math.max(2, b.w - 2)}" height="${Math.max(2, b.h - 2)}" rx="3" fill="none" stroke="#34e39a" stroke-width="${stroke}"/>`
    )
    .join('');
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`
  );

  const out = await sharp(buffer)
    .composite([{ input: svg, top: 0, left: 0 }])
    .resize({ width: Math.round(width * scale), height: Math.round(height * scale), fit: 'fill' })
    .jpeg({ quality: 80 })
    .toBuffer();

  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

app.get('/api/health', async (req, res) => {
  try {
    await getSession();
    res.json({ ok: true, model: 'yolov10n (COCO vehicles)', port: PORT });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/analyze', (req, res) => {
  upload.array('images', 5)(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Please add at least one image.' });

    const mode = ['fast', 'balanced', 'accurate'].includes(req.body.mode) ? req.body.mode : 'balanced';
    const conf = Math.min(0.9, Math.max(0.05, parseFloat(req.body.conf) || 0.12));
    const detectMode = mode === 'fast' ? 'full' : mode === 'accurate' ? 'auto' : 'full';

    try {
      const results = [];
      for (const file of files) {
        let meta;
        try {
          meta = await sharp(file.buffer).metadata();
        } catch {
          throw new Error(`"${file.originalname}" is not a readable image.`);
        }
        if (!meta.width || !meta.height) throw new Error(`"${file.originalname}" is not a readable image.`);

        const t0 = Date.now();
        const result = await detect(file.buffer, { conf, mode: detectMode });
        const thumb = await annotatedPreview(file.buffer, result);
        const avgConfidence = result.boxes.length
          ? result.boxes.reduce((s, b) => s + b.score, 0) / result.boxes.length
          : 0;

        results.push({
          name: file.originalname,
          count: result.count,
          width: result.width,
          height: result.height,
          boxes: result.boxes,
          avgConfidence: Math.round(avgConfidence * 1000) / 10, // percent, 1 decimal
          inferenceMs: Date.now() - t0,
          thumb,
        });
      }

      const counts = results.map((r) => r.count);
      const total = counts.reduce((a, b) => a + b, 0);
      const average = total / counts.length;
      const sorted = [...counts].sort((a, b) => a - b);
      const median = sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

      res.json({
        ok: true,
        images: results,
        summary: {
          photos: results.length,
          total,
          average: Math.round(average * 10) / 10,
          median,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mode,
          confidenceThreshold: conf,
        },
      });
    } catch (err) {
      console.error('[analyze]', err);
      res.status(500).json({ error: err.message || 'Analysis failed.' });
    }
  });
});

app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: err.message || 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`\n  ParkPulse running -> http://localhost:${PORT}\n`);
  getSession()
    .then(() => console.log('  Detection model loaded: YOLOv10n (COCO vehicles)\n'))
    .catch((err) => console.error('  Model failed to load:', err.message, '\n'));
});
