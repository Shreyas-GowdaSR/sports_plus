"""Gemini embeddings over plain HTTPS (no SDK needed).

Vectors are truncated to DIM dimensions (Matryoshka truncation, supported by
gemini-embedding-001) and L2-normalised, so inner product == cosine similarity.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

MODEL = 'gemini-embedding-001'
DIM = 768
BATCH = 50
ENDPOINT = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents'


def api_key() -> str:
    key = os.environ.get('GEMINI_API_KEY')
    if key:
        return key
    env_file = Path(__file__).resolve().parent.parent / '.env.local'
    if env_file.exists():
        match = re.search(r'^\s*GEMINI_API_KEY\s*=\s*[\'"]?([^\'"\r\n]+)', env_file.read_text(encoding='utf8'), re.M)
        if match:
            return match.group(1).strip()
    raise SystemExit('GEMINI_API_KEY is not set (environment or frontend/.env.local).')


def _post(body: dict, key: str) -> dict:
    request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode('utf8'), method='POST',
                                     headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 503) and attempt < 5:
                wait = 2 ** attempt * 5
                print(f'  embedding API {error.code}; retrying in {wait}s')
                time.sleep(wait)
                continue
            raise SystemExit(f'Embedding request failed: HTTP {error.code} {error.read()[:300]!r}')
    raise SystemExit('Embedding request failed after retries.')


def normalise(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return (vectors / np.maximum(norms, 1e-12)).astype('float32')


def embed(texts: list[str], task: str, titles: list[str] | None = None) -> np.ndarray:
    """task is RETRIEVAL_DOCUMENT for corpus chunks, RETRIEVAL_QUERY for questions."""
    key = api_key()
    rows: list[list[float]] = []
    for start in range(0, len(texts), BATCH):
        requests = []
        for offset, text in enumerate(texts[start:start + BATCH]):
            item = {'model': f'models/{MODEL}', 'content': {'parts': [{'text': text}]},
                    'taskType': task, 'outputDimensionality': DIM}
            if titles and task == 'RETRIEVAL_DOCUMENT':
                item['title'] = titles[start + offset]
            requests.append(item)
        rows.extend(item['values'] for item in _post({'requests': requests}, key)['embeddings'])
    return normalise(np.array(rows, dtype='float32'))
