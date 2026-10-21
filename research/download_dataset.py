"""Download the processed Fukuchi running-biomechanics tables with provenance checks."""

from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path


ARTICLE_API = "https://api.figshare.com/v2/articles/4543435"
DATA_DIR = Path(__file__).resolve().parents[1] / "storage" / "datasets" / "fukuchi2017"


def md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(ARTICLE_API, headers={"User-Agent": "SportsAI-Research/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        article = json.load(response)

    # The current API response includes historical metadata files with duplicate
    # names. Keep only the final entry for each filename.
    by_name = {
        item["name"]: item for item in article["files"]
        if item["name"].endswith("processed.txt") or item["name"] in {"RBDSinfo.txt", "RBDSinfo.xlsx"}
    }
    files = list(by_name.values())
    if not files:
        raise RuntimeError("No processed tables or metadata were returned by Figshare.")

    manifest = {
        "title": article["title"],
        "doi": article["doi"],
        "license": article["license"]["name"],
        "license_url": article["license"]["url"],
        "citation": article["citation"],
        "source_api": ARTICLE_API,
        "files": [],
    }
    for item in files:
        destination = DATA_DIR / item["name"]
        expected = item["supplied_md5"]
        if destination.exists() and md5(destination) == expected:
            print(f"verified existing {item['name']}")
        else:
            print(f"downloading {item['name']} ({item['size']:,} bytes)")
            request = urllib.request.Request(
                item["download_url"], headers={"User-Agent": "SportsAI-Research/1.0"}
            )
            temporary = destination.with_suffix(destination.suffix + ".part")
            try:
                with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as out:
                    while block := response.read(1024 * 1024):
                        out.write(block)
                actual = md5(temporary)
                if actual != expected:
                    raise RuntimeError(f"MD5 mismatch for {item['name']}: expected {expected}, got {actual}")
                temporary.replace(destination)
            finally:
                temporary.unlink(missing_ok=True)
        manifest["files"].append({
            "name": item["name"],
            "size_bytes": item["size"],
            "download_url": item["download_url"],
            "md5": expected,
        })

    manifest_path = DATA_DIR / "dataset_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Downloaded and verified {len(files)} files into {DATA_DIR}")
    print(f"Provenance manifest: {manifest_path}")


if __name__ == "__main__":
    main()

