"""Build the coach's vector index.

    python rag/build_index.py            # from the frontend folder

1. Reads knowledge/corpus/*.md into one chunk per cited section.
2. Embeds each chunk with gemini-embedding-001 (RETRIEVAL_DOCUMENT, 768 dims,
   L2-normalised). Chunks whose text has not changed reuse their old vector.
3. Builds a FAISS IndexFlatIP (exact inner-product search = cosine similarity on
   normalised vectors) and writes it to knowledge/index/index.faiss.
4. Writes the same vectors as raw float32 (vectors.f32) plus chunks.json, which
   the Node server loads at start-up to run the identical flat search.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

import faiss
import numpy as np

from corpus import INDEX_DIR, load_chunks
from embed import DIM, MODEL, embed


def previous_vectors() -> dict[str, np.ndarray]:
    meta_path, vec_path = INDEX_DIR / 'chunks.json', INDEX_DIR / 'vectors.f32'
    if not meta_path.exists() or not vec_path.exists():
        return {}
    meta = json.loads(meta_path.read_text(encoding='utf8'))
    if meta.get('model') != MODEL or meta.get('dim') != DIM:
        return {}
    vectors = np.fromfile(vec_path, dtype='<f4').reshape(-1, DIM)
    return {chunk['hash']: vectors[row] for row, chunk in enumerate(meta['chunks']) if row < len(vectors)}


def main() -> None:
    chunks = load_chunks()
    cached = previous_vectors()
    todo = [chunk for chunk in chunks if chunk.hash not in cached]
    print(f'{len(chunks)} chunks from {len({c.doc for c in chunks})} documents; '
          f'{len(chunks) - len(todo)} cached, {len(todo)} to embed with {MODEL}')
    if todo:
        fresh = embed([c.embed_text() for c in todo], 'RETRIEVAL_DOCUMENT', [c.doc_title for c in todo])
        cached.update({chunk.hash: fresh[row] for row, chunk in enumerate(todo)})

    vectors = np.stack([cached[chunk.hash] for chunk in chunks]).astype('float32')
    index = faiss.IndexFlatIP(DIM)
    index.add(vectors)

    # Sanity check: each chunk's nearest neighbour in the index is itself.
    _, self_hits = index.search(vectors, 1)
    misses = int((self_hits[:, 0] != np.arange(len(chunks))).sum())
    if misses:
        sys.exit(f'index self-check failed for {misses} chunks')

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(INDEX_DIR / 'index.faiss'))
    vectors.astype('<f4').tofile(INDEX_DIR / 'vectors.f32')
    meta = {
        'model': MODEL, 'dim': DIM, 'metric': 'inner_product (cosine on L2-normalised vectors)',
        'faiss': f'IndexFlatIP, faiss {faiss.__version__}',
        'built': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'count': len(chunks), 'documents': len({c.doc for c in chunks}),
        'sources': len({c.source for c in chunks}),
        'chunks': [chunk.as_json() for chunk in chunks],
    }
    (INDEX_DIR / 'chunks.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf8')
    print(f'wrote {INDEX_DIR / "index.faiss"} ({index.ntotal} vectors x {DIM}), vectors.f32 and chunks.json')


if __name__ == '__main__':
    main()
