import { drillsFor, footStrikeTalk, statusWord, talkFor, verdict, videoLink } from './plainTalk'
import type { SavedCheck } from './store'

type PdfLine = { text: string; kind: 'title' | 'subtitle' | 'section' | 'body' | 'spacer' }

function pdfSafe(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[×]/g, 'x')
    .replace(/[°]/g, ' deg')
    .replace(/[·•]/g, '|')
    .replace(/[₹]/g, 'INR ')
    .replace(/[→↗]/g, '->')
    .replace(/[^\x20-\x7E]/g, '')
}

function wrap(text: string, width = 88): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (word.length > width) {
      if (current) lines.push(current)
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width))
      current = ''
      continue
    }
    if (current && `${current} ${word}`.length > width) {
      lines.push(current)
      current = word
    } else current = current ? `${current} ${word}` : word
  }
  if (current) lines.push(current)
  return lines
}

function makeLines(analysis: SavedCheck, athlete: string): PdfLine[] {
  const v = verdict(analysis.score)
  const lines: PdfLine[] = [
    { text: 'Running Form Report', kind: 'title' },
    { text: `${athlete ? `${athlete} | ` : ''}${analysis.sourceName} | ${new Date(analysis.createdAt).toLocaleDateString()}`, kind: 'subtitle' },
    { text: `Form score ${analysis.score}/100 - ${v.word}`, kind: 'section' },
    { text: v.line, kind: 'body' },
    { text: '', kind: 'spacer' },
    { text: 'WHAT WE CHECKED', kind: 'section' },
  ]
  for (const metric of analysis.metrics) {
    const talk = talkFor(metric, analysis.view)
    lines.push({ text: `${talk.name}: ${metric.score}/100 (${statusWord(metric.status)})`, kind: 'body' })
    lines.push({ text: metric.status === 'good' ? talk.good : `${talk.issue} What to do: ${talk.fix}`, kind: 'body' })
    lines.push({ text: '', kind: 'spacer' })
  }
  const strike = footStrikeTalk(analysis)
  lines.push({ text: 'FOOT LANDING', kind: 'section' })
  lines.push({ text: `${strike.type}. ${strike.landing}`, kind: 'body' })
  lines.push({ text: '', kind: 'spacer' })
  lines.push({ text: 'DRILLS FOR THE NEXT 2 WEEKS', kind: 'section' })
  drillsFor(analysis.metrics).forEach(drill => {
    lines.push({ text: `${drill.name} (${drill.dose}) - ${drill.how}`, kind: 'body' })
    lines.push({ text: `Video: ${videoLink(drill)}`, kind: 'subtitle' })
  })
  lines.push({ text: '', kind: 'spacer' })
  lines.push({ text: 'This is a video-based form check, not a medical diagnosis. If something hurts, see a doctor or physio.', kind: 'subtitle' })
  return lines
}

function pdfText(text: string, x: number, y: number, size: number, font = 'F1', color = '0.16 0.21 0.25'): string {
  const escaped = pdfSafe(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  return `${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escaped}) Tj ET\n`
}

export function createRunningReportPdf(analysis: SavedCheck, athlete: string): Blob {
  const sourceLines = makeLines(analysis, athlete)
  const pages: PdfLine[][] = [[]]
  let y = 744

  for (const line of sourceLines) {
    if (line.kind === 'spacer') {
      y -= 9
      continue
    }
    const size = line.kind === 'title' ? 21 : line.kind === 'section' ? 11 : line.kind === 'subtitle' ? 9 : 9
    const wrapped = wrap(line.text, line.kind === 'title' ? 51 : 94)
    for (const part of wrapped) {
      const height = line.kind === 'section' ? 19 : line.kind === 'title' ? 28 : 14
      if (y < 62) {
        pages.push([])
        y = 770
      }
      pages[pages.length - 1].push({ ...line, text: part })
      y -= height
    }
  }

  const pageIds = pages.map((_, index) => 3 + index * 2)
  const fontId = 3 + pages.length * 2
  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`

  pages.forEach((page, pageIndex) => {
    let stream = ''
    stream += '0.99 0.98 0.95 rg 0 0 595 842 re f\n'
    stream += '0.06 0.06 0.07 rg 0 812 595 30 re f\n'
    stream += pdfText('SPORTSAI+', 48, 823, 10, 'F2', '0.85 0.72 0.45')
    stream += '0.85 0.72 0.45 RG 48 790 m 547 790 l S\n'
    let cursorY = 762
    for (const line of page) {
      if (line.kind === 'title') {
        stream += pdfText(line.text, 48, cursorY, 20, 'F2', '0.07 0.13 0.20')
        cursorY -= 27
      } else if (line.kind === 'section') {
        stream += `0.95 0.91 0.82 rg 45 ${cursorY - 4} 505 17 re f\n`
        stream += pdfText(line.text, 52, cursorY, 10, 'F2', '0.45 0.34 0.13')
        cursorY -= 19
      } else {
        const color = line.kind === 'subtitle' ? '0.35 0.41 0.46' : '0.16 0.21 0.25'
        stream += pdfText(line.text, 52, cursorY, line.kind === 'subtitle' ? 8 : 9, 'F1', color)
        cursorY -= 14
      }
    }
    stream += `0.40 0.45 0.48 rg BT /F1 8 Tf 1 0 0 1 48 34 Tm (SportsAI+ | Page ${pageIndex + 1} of ${pages.length}) Tj ET\n`
    const pageId = pageIds[pageIndex]
    const contentId = pageId + 1
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontId + 1} 0 R >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
  })
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objects[fontId + 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  let document = '%PDF-1.4\n%SportsAI PDF\n'
  const offsets = [0]
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = document.length
    document += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xrefOffset = document.length
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) document += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new Blob([document], { type: 'application/pdf' })
}
