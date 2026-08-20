/** Shown wherever the user is waiting on the coach — the app itself never
 *  calls an LLM, so this explains the one manual step. */
export function CoachHelp() {
  return (
    <div className="card">
      <strong className="small">How to run the coach</strong>
      <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
        <li>Open a terminal in the <code>wortschatz</code> project folder</li>
        <li>Run <code>claude</code></li>
        <li>Type <code>/coach</code></li>
      </ol>
      <div className="small dim" style={{ marginTop: 8 }}>
        It researches unknown words, writes requested grammar topics, suggests new
        vocabulary and builds the weekly exam — all on your Claude subscription, no API key.
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>
        Want it automatic? <code>claude -p "/coach"</code> runs it non-interactively, so it
        works from a weekly cron entry.
      </div>
    </div>
  )
}
