import { type ReactNode } from 'react'

/**
 * Minimal markdown renderer for grammar theory. Deliberately dependency-free
 * and deliberately limited to what the theory actually uses: headings, lists,
 * pipe tables, blockquotes, bold/italic/code, paragraphs.
 *
 * Everything is rendered as React elements — no dangerouslySetInnerHTML — so
 * coach-written content can never inject markup.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = re.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyBase}-${i++}`
    if (token.startsWith('**')) out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) out.push(<code key={key}>{token.slice(1, -1)}</code>)
    else out.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const content = inline(heading[2], `h${key}`)
      blocks.push(
        level <= 2 ? <h2 key={key++}>{content}</h2>
          : level === 3 ? <h3 key={key++}>{content}</h3>
          : <h4 key={key++}>{content}</h4>,
      )
      i++
      continue
    }

    // pipe table
    if (line.includes('|') && lines[i + 1]?.match(/^\s*\|?[\s:|-]+\|/)) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++ }
      blocks.push(
        <table key={key++}>
          <thead><tr>{header.map((h, n) => <th key={n}>{inline(h, `th${n}`)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, n) => (
              <tr key={n}>{r.map((c, m) => <td key={m}>{inline(c, `td${n}-${m}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push(<blockquote key={key++}>{inline(quote.join(' '), `q${key}`)}</blockquote>)
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++ }
      blocks.push(<ul key={key++}>{items.map((t, n) => <li key={n}>{inline(t, `li${n}`)}</li>)}</ul>)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
      blocks.push(<ol key={key++}>{items.map((t, n) => <li key={n}>{inline(t, `oi${n}`)}</li>)}</ol>)
      continue
    }

    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) && !lines[i].includes('|')) {
      para.push(lines[i]); i++
    }
    if (para.length) blocks.push(<p key={key++}>{inline(para.join(' '), `p${key}`)}</p>)
    else i++
  }

  return <div className="theory">{blocks}</div>
}
