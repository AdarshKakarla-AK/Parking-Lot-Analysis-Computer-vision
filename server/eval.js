const fs = require('fs');
const path = require('path');
const { detect } = require('./detector');

const split = process.argv[2] || 'valid';
const mode = process.argv[3] || 'full';
const conf = parseFloat(process.argv[4] || '0.25');
const limit = parseInt(process.argv[5] || '1000', 10);

(async () => {
  const dir = path.join(__dirname, '..', 'data', split);
  const coco = JSON.parse(fs.readFileSync(path.join(dir, '_annotations.coco.json'), 'utf8'));
  const gtById = {};
  for (const a of coco.annotations) {
    if (!gtById[a.image_id]) gtById[a.image_id] = 0;
    gtById[a.image_id]++;
  }
  const images = coco.images.slice(0, limit);
  let ae = 0, se = 0, n = 0, gtSum = 0, predSum = 0;
  const t0 = Date.now();
  for (const img of images) {
    const buf = fs.readFileSync(path.join(dir, img.file_name));
    const res = await detect(buf, { conf, mode });
    const gt = gtById[img.id] || 0;
    const err = res.count - gt;
    ae += Math.abs(err); se += err * err; n++;
    gtSum += gt; predSum += res.count;
    console.log(`${img.file_name}\tgt=${gt}\tpred=${res.count}\terr=${err}`);
  }
  console.log('\nSPLIT', split, 'MODE', mode, 'CONF', conf, 'N', n);
  console.log('MAE', (ae / n).toFixed(2), 'RMSE', Math.sqrt(se / n).toFixed(2), 'bias', ((predSum - gtSum) / n).toFixed(2));
  console.log('avg gt', (gtSum / n).toFixed(1), 'avg pred', (predSum / n).toFixed(1));
  console.log('ms/image', ((Date.now() - t0) / n).toFixed(0));
})();
