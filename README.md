# ParkPulse — Parking Lot Revenue Estimator

A local website that looks at photos of a parking lot, counts the vehicles with a
computer-vision model, averages the footfall across up to five photos, and turns that
into a rough estimate of the day's sales.

**Running now at → http://localhost:9090**

---

## Stack

- **Node.js + Express** — web server on port `9090`
- **ONNX Runtime** — runs the YOLOv10n detector locally (CPU)
- **sharp** — image decoding, letterboxing, annotated previews
- **Vanilla HTML/CSS/JS** — no front-end build step, no CDN, works offline

The model is pre-trained on COCO vehicles (`car`, `motorcycle`, `bus`, `truck`).
On this dataset's held-out images it averages **~3–5 cars error per photo** at the
default sensitivity (`conf = 0.12`).

## Run it

```bash
cd C:\Users\allst\parking-lot-analyzer
npm start
```

Then open http://localhost:9090. You can also double-click `run.bat`.

The first run loads the model (≈1–2 s). Photos are processed in memory and never
leave the machine.

## How the estimate works

For each photo the model counts vehicles. The app then computes:

```
average footfall  = total cars across photos ÷ number of photos
average sale/car  = (lowest average sale + highest average sale) ÷ 2
estimated sales   = average footfall × average sale/car
```

It also shows the conservative (`avg cars × low`) and optimistic (`avg cars × high`)
range, a weekly and 30-day projection, and optional occupancy if you enter the lot's
capacity.

The sale values, currency, capacity and detection mode are editable. Price changes
recalculate instantly **without re-running detection**. Settings are saved in
`localStorage`.

## Using the site

1. Add up to **5 photos** of the same lot (drag & drop, file picker, or **Try demo lot**).
2. Enter your **lowest** and **highest average sale per car**, pick a currency.
   Optionally add lot capacity and choose a detection mode:
   - **Fast** — single pass, ~70 ms/photo
   - **Balanced** *(default)* — single pass at `conf 0.12`
   - **High accuracy** — full image + 2×2 tiled passes merged with NMS, ~330 ms/photo
3. Click **Analyze parking lot**. You get total cars, average footfall, occupancy,
   estimated daily sales, the arithmetic breakdown, per-photo counts, and annotated
   images showing every detected vehicle (click any image to enlarge).

## Project layout

```
parking-lot-analyzer/
├─ server/
│  ├─ index.js       Express server, /api/analyze, annotated previews
│  ├─ detector.js    YOLOv10 ONNX inference, letterboxing, tiling, NMS
│  └─ eval.js        Accuracy benchmark against the COCO annotations
├─ public/
│  ├─ index.html     UI
│  ├─ styles.css     Dark dashboard styling
│  ├─ app.js         Uploads, API calls, live calculations
│  └─ samples/       5 demo lot photos
├─ models/
│  └─ yolov10n.onnx  9.4 MB detector weights
├─ data/             Roboflow COCO dataset (train / valid / test + annotations)
└─ run.bat           Starts the server and opens the browser
```

## Benchmark the detector (optional)

```bash
node server/eval.js valid full 0.12
node server/eval.js test  full 0.12
node server/eval.js valid auto 0.12
```

Arguments: `split` (`train` | `valid` | `test`), `mode` (`full` | `tiles` | `auto`),
`confidence threshold`, and an optional image limit.

Measured on this dataset (15 validation images, 15 test images):

| Mode | Val MAE | Test MAE | Avg inference |
|---|---|---|---|
| full @ 0.12 | 4.9 | 3.0 | ~70 ms |
| full + tiles @ 0.12 | 3.7 | 3.7 | ~330 ms |
| tiles @ 0.25 | 5.9 | 3.9 | ~280 ms |

## API

`POST /api/analyze` — multipart form:

- `images` — 1 to 5 files (JPG, PNG, WebP, AVIF, BMP; 20 MB each)
- `mode` — `fast` | `balanced` | `accurate`

Returns per-photo counts, boxes, confidence, annotated JPEG data URLs, and a
summary (`total`, `average`, `median`, `min`, `max`).

`GET /api/health` — model/server status.

## Limitations

This is a directional estimate, not accounting. It does not model dwell time, hourly
turnover, free or validated parking, seasonality, or missed/occluded vehicles. Counts
are snapshots from still photos; for true daily revenue you would combine them with
actual parking-duration and fee data.
