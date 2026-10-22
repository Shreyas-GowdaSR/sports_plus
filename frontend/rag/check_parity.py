"""Check that the Node server's flat search returns the same passages as FAISS.

    node scripts/eval-rag.mjs      # writes rag/eval/node-rankings.json
    python rag/check_parity.py

Searches knowledge/index/index.faiss with the cached evaluation question vectors and
compares the top 5 chunk rows with the rows the Node retriever produced.
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import faiss
import numpy as np

from corpus import INDEX_DIR
from embed import normalise

EVAL_DIR = Path(__file__).resolve().parent / 'eval'


def main() -> None:
    index = faiss.read_index(str(INDEX_DIR / 'index.faiss'))
    cached = json.loads((EVAL_DIR / 'query-vectors.json').read_text(encoding='utf8'))['vectors']
    node = json.loads((EVAL_DIR / 'node-rankings.json').read_text(encoding='utf8'))
    questions = list(node)
    queries = normalise(np.stack([np.frombuffer(base64.b64decode(cached[q]), dtype='<f4') for q in questions]))
    scores, rows = index.search(queries, 5)
    mismatches = 0
    for question, faiss_rows, faiss_scores in zip(questions, rows.tolist(), scores):
        if faiss_rows != node[question]:
            # A swap between two chunks with (near) identical scores is a tie, not a bug.
            tie = sorted(faiss_rows) == sorted(node[question]) and np.diff(np.sort(faiss_scores)).min() < 1e-5
            if not tie:
                mismatches += 1
                print(f'MISMATCH  {question}\n  faiss {faiss_rows}\n  node  {node[question]}')
    print(f'{index.ntotal} vectors · {len(questions)} questions · top-5 rankings identical for '
          f'{len(questions) - mismatches}/{len(questions)}')
    sys.exit(1 if mismatches else 0)


if __name__ == '__main__':
    main()
