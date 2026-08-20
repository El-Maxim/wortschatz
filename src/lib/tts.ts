/**
 * German text-to-speech via the Web Speech API — free, offline on most devices,
 * no key. Voice lists load asynchronously on some browsers, so we resolve lazily.
 */
let voice: SpeechSynthesisVoice | null = null
let resolved = false

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices()
  if (!voices.length) return null
  const german = voices.filter(v => v.lang?.toLowerCase().startsWith('de'))
  if (!german.length) return null
  // Prefer a de-DE voice; local (on-device) ones work offline.
  return (
    german.find(v => v.lang.toLowerCase() === 'de-de' && v.localService) ??
    german.find(v => v.lang.toLowerCase() === 'de-de') ??
    german.find(v => v.localService) ??
    german[0]
  )
}

export function speechAvailable(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function speak(text: string): void {
  if (!speechAvailable() || !text.trim()) return
  if (!resolved) { voice = pickVoice(); resolved = voice !== null }
  speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'de-DE'
  if (voice) utter.voice = voice
  utter.rate = 0.92
  speechSynthesis.speak(utter)
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener?.('voiceschanged', () => { voice = pickVoice(); resolved = voice !== null })
}
