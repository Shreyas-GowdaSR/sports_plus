"""Read the curated knowledge corpus (knowledge/corpus/*.md) into retrieval chunks.

Each Markdown file has a small front matter block (title, topic) followed by
"## " sections. A section carries its own citation lines:

    ## Section heading
    Source: Author et al. Title. Journal Year;Vol:Pages
    Link: https://doi.org/...
    Cite: Short label (optional; otherwise built from the first author and year)

    Body text...

One section becomes one chunk, so every chunk the coach sees has exactly one
source. Sections longer than MAX_WORDS are split on paragraph boundaries and
keep the heading and citation.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, asdict
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent
CORPUS_DIR = FRONTEND / 'knowledge' / 'corpus'
INDEX_DIR = FRONTEND / 'knowledge' / 'index'
MAX_WORDS = 230


@dataclass
class Chunk:
    id: str
    doc: str
    doc_title: str
    section: str
    topic: str
    source: str
    url: str
    text: str
    cite: str = ''
    hash: str = ''

    def embed_text(self) -> str:
        return f'{self.section}\n{self.text}'

    def as_json(self) -> dict:
        data = asdict(self)
        data['docTitle'] = data.pop('doc_title')
        return data


def slug(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')[:60]


def short_cite(source: str) -> str:
    """'Thomas DT, Erdman KA, Burke LM. Title. Journal 2016;...' -> 'Thomas et al. 2016'."""
    authors = source.split('. ')[0]
    year = re.search(r'\b(19|20)\d{2}\b', source)
    year = f' {year.group(0)}' if year else ''
    if re.match(r"^[A-Z][\w'-]+ [A-Z]{1,3}\b", authors):  # personal authors: "Surname AB, ..."
        names = [name.split()[0] for name in authors.replace(' et al', '').split(', ')]
        if len(names) == 1 and 'et al' not in authors:
            return f'{names[0]}{year}'
        if len(names) == 2 and 'et al' not in authors:
            return f'{names[0]} and {names[1]}{year}'
        return f'{names[0]} et al.{year}'
    return f'{authors}{year}'  # an organisation; long names use a "Cite:" line instead


def _front_matter(raw: str) -> tuple[dict, str]:
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', raw, re.S)
    if not match:
        return {}, raw
    meta = dict(line.split(':', 1) for line in match.group(1).splitlines() if ':' in line)
    return {key.strip(): value.strip() for key, value in meta.items()}, raw[match.end():]


def _split_long(body: str) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', body) if p.strip()]
    parts, current = [], []
    for paragraph in paragraphs:
        if current and len(' '.join(current + [paragraph]).split()) > MAX_WORDS:
            parts.append('\n\n'.join(current))
            current = []
        current.append(paragraph)
    if current:
        parts.append('\n\n'.join(current))
    return parts


def load_chunks(corpus_dir: Path = CORPUS_DIR) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(corpus_dir.glob('*.md')):
        meta, body = _front_matter(path.read_text(encoding='utf8'))
        doc = path.stem
        for block in re.split(r'^## ', body, flags=re.M)[1:]:
            heading, _, rest = block.partition('\n')
            source = re.search(r'^Source:\s*(.+)$', rest, re.M)
            link = re.search(r'^Link:\s*(\S+)$', rest, re.M)
            cite = re.search(r'^Cite:\s*(.+)$', rest, re.M)
            if not source:
                raise ValueError(f'{path.name} / "{heading.strip()}" has no Source: line')
            text = re.sub(r'^(Source|Link|Cite):.*$', '', rest, flags=re.M).strip()
            parts = _split_long(text)
            for index, part in enumerate(parts):
                section = heading.strip()
                chunk_id = f'{doc}#{slug(section)}' + (f'-{index + 1}' if len(parts) > 1 else '')
                chunk = Chunk(chunk_id, doc, meta.get('title', doc), section, meta.get('topic', 'general'),
                              source.group(1).strip(), link.group(1).strip() if link else '', part,
                              cite.group(1).strip() if cite else short_cite(source.group(1).strip()))
                chunk.hash = hashlib.sha1(chunk.embed_text().encode('utf8')).hexdigest()[:16]
                chunks.append(chunk)
    ids = [chunk.id for chunk in chunks]
    duplicates = {chunk_id for chunk_id in ids if ids.count(chunk_id) > 1}
    if duplicates:
        raise ValueError(f'duplicate chunk ids: {sorted(duplicates)}')
    return chunks
