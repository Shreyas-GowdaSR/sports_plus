# Phase 1 tables (all runners)

Runners: 36 · trials: 96 · synthetic clips: 6912 (each scored twice: app as-is and with the aspect fix)

### Side view, typical detector noise: foot contacts

| Setting | Contacts found (recall) | Detections that are real (precision) | Timing bias | Step-rate error (steps/min) |
|---|---|---|---|---|
| App today · portrait · 60 fps | 99% | 32% | -45 ms | 372 |
| App today · portrait · 30 fps | 100% | 28% | -21 ms | 454 |
| App today · landscape · 60 fps | 99% | 32% | -44 ms | 373 |
| App today · landscape · 30 fps | 100% | 27% | -23 ms | 454 |
| App + aspect fix · portrait · 60 fps | 99% | 32% | -45 ms | 372 |
| App + aspect fix · portrait · 30 fps | 100% | 28% | -21 ms | 454 |
| App + aspect fix · landscape · 60 fps | 99% | 32% | -44 ms | 373 |
| App + aspect fix · landscape · 30 fps | 100% | 27% | -23 ms | 454 |

### Side view, typical detector noise: form measures

| Setting | Foot strike: clip label given | Foot strike: clip label correct | Foot strike: per contact correct | Landing ahead/under correct | Landing distance error (torso lengths) | Pelvic bounce error (% torso) | Knee angle error (RMSE) |
|---|---|---|---|---|---|---|---|
| App today · portrait · 60 fps | 0% | – | 31% | – | 0.28 | 63 | 19.5° |
| App today · portrait · 30 fps | 0% | – | 35% | – | 0.25 | 56 | 21.4° |
| App today · landscape · 60 fps | 41% | 33% | 43% | 47% | 0.25 | 28 | 14.1° |
| App today · landscape · 30 fps | 59% | 24% | 47% | 41% | 0.24 | 26 | 13.4° |
| App + aspect fix · portrait · 60 fps | 9% | – | 39% | – | 0.16 | 61 | 6.8° |
| App + aspect fix · portrait · 30 fps | 19% | 53% | 43% | 46% | 0.13 | 54 | 8.3° |
| App + aspect fix · landscape · 60 fps | 10% | – | 39% | – | 0.16 | 27 | 6.8° |
| App + aspect fix · landscape · 30 fps | 16% | 35% | 41% | 30% | 0.13 | 25 | 8.3° |

### Noise sensitivity (side view, portrait, 60 fps)

| Setting | Contacts found (recall) | Detections that are real (precision) | Timing bias | Step-rate error (steps/min) | Foot strike: clip label given | Foot strike: clip label correct | Foot strike: per contact correct | Landing ahead/under correct | Landing distance error (torso lengths) | Pelvic bounce error (% torso) | Knee angle error (RMSE) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| App today · noise none | 97% | 93% | +29 ms | 10 | 99% | 15% | 21% | 74% | 0.16 | 6 | 17.6° |
| App today · noise typical | 99% | 32% | -45 ms | 372 | 0% | – | 31% | – | 0.28 | 63 | 19.5° |
| App today · noise hard | 99% | 30% | -25 ms | 404 | 1% | – | 34% | – | 0.41 | 128 | 25.4° |
| App + aspect fix · noise none | 97% | 93% | +29 ms | 10 | 89% | 15% | 24% | 36% | 0.20 | 5 | 1.9° |
| App + aspect fix · noise typical | 99% | 32% | -45 ms | 372 | 9% | – | 39% | – | 0.16 | 61 | 6.8° |
| App + aspect fix · noise hard | 99% | 30% | -25 ms | 404 | 13% | – | 38% | – | 0.26 | 127 | 15.6° |

### Camera-view detection and knee angle by view (app today, 60 fps, typical noise)

| Setting | View detected correctly | Knee angle error (RMSE) | Pelvic level error, front/back (% torso) |
|---|---|---|---|
| side · portrait | 96% | 19.5° | – |
| side · landscape | 96% | 14.1° | – |
| oblique · portrait | 99% | 14.9° | – |
| oblique · landscape | 4% | 21.9° | – |
| front · portrait | 96% | 33.4° | 4 |
| front · landscape | 0% | 42.6° | – |
| back · portrait | 96% | 36.1° | 4 |
| back · landscape | 0% | 45.4° | – |

### Knee angle from 2D after the aspect fix (portrait, 60 fps, typical noise)

| Setting | Knee angle error (RMSE) |
|---|---|
| side | 6.8° |
| oblique | 13.1° |
| front | 38.2° |
| back | 41.2° |
