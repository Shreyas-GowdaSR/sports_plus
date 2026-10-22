"""Query the FAISS index from the command line.

    python rag/search.py "how much protein after gym"
"""
from __future__ import annotations

import json
import sys

import faiss

from corpus import INDEX_DIR
from embed import embed


def main() -> None:
    query = ' '.join(sys.argv[1:]).strip()
    if not query:
        sys.exit('usage: python rag/search.py "your question"')
    index = faiss.read_index(str(INDEX_DIR / 'index.faiss'))
    chunks = json.loads((INDEX_DIR / 'chunks.json').read_text(encoding='utf8'))['chunks']
    scores, rows = index.search(embed([query], 'RETRIEVAL_QUERY'), 5)
    for score, row in zip(scores[0], rows[0]):
        chunk = chunks[row]
        print(f'{score:.3f}  {chunk["id"]}\n       {chunk["source"][:100]}')


if __name__ == '__main__':
    main()
