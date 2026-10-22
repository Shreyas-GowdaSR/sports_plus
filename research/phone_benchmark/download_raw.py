"""Download the raw Fukuchi 2017 running trials (3D markers, treadmill forces, static
calibration) with MD5 checks.

    python research/phone_benchmark/download_raw.py

About 420 MB goes to storage/datasets/fukuchi2017/raw/ (gitignored). The .c3d copies
of the same trials are skipped. Source: Fukuchi RK, Fukuchi CA, Duarte M. A public
dataset of running biomechanics and the effects of running speed on lower extremity
kinematics and kinetics. PeerJ 2017;5:e3298. Data: doi:10.6084/m9.figshare.4543435.v5,
CC BY 4.0.
"""
from __future__ import annotations

import hashlib
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ARTICLE_API = 'https://api.figshare.com/v2/articles/4543435'
RAW_DIR = Path(__file__).resolve().parents[2] / 'storage' / 'datasets' / 'fukuchi2017' / 'raw'
HEADERS = {'User-Agent': 'SportsAI-Research/1.0'}


def md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def wanted(name: str) -> bool:
    return name.endswith(('markers.txt', 'forces.txt', 'static.txt')) or name == 'RBDSinfo.txt'


def fetch(item: dict) -> str:
    destination = RAW_DIR / item['name']
    if destination.exists() and md5(destination) == item['supplied_md5']:
        return f'ok (cached) {item["name"]}'
    temporary = destination.with_suffix('.part')
    request = urllib.request.Request(item['download_url'], headers=HEADERS)
    with urllib.request.urlopen(request, timeout=300) as response, temporary.open('wb') as out:
        while block := response.read(1 << 20):
            out.write(block)
    if md5(temporary) != item['supplied_md5']:
        temporary.unlink()
        raise RuntimeError(f'MD5 mismatch for {item["name"]}')
    temporary.replace(destination)
    return f'downloaded {item["name"]} ({item["size"] / 1e6:.1f} MB)'


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(f'{ARTICLE_API}/files?page_size=1000', headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        files = json.load(response)
    # Keep the last entry per name (the API repeats some historical files).
    items = list({item['name']: item for item in files if wanted(item['name'])}.values())
    print(f'{len(items)} files, {sum(i["size"] for i in items) / 1e6:.0f} MB')
    with ThreadPoolExecutor(max_workers=6) as pool:
        for line in pool.map(fetch, items):
            print(line, flush=True)
    (RAW_DIR / 'manifest.json').write_text(json.dumps(
        {'source': ARTICLE_API, 'license': 'CC BY 4.0', 'doi': '10.6084/m9.figshare.4543435.v5',
         'files': {i['name']: i['supplied_md5'] for i in items}}, indent=1), encoding='utf8')


if __name__ == '__main__':
    main()
