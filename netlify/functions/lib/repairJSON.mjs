// repairJSON.js
// Attempts to repair truncated/fenced JSON from Claude responses.
// Same approach as correlate-genes-blood-background.js's local helper,
// extracted here so new AI functions can share it.

export function repairJSON(raw) {
  let text = raw.trim()
  text = text.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  try { return JSON.parse(text) } catch {}

  const objStart = text.indexOf('{')
  if (objStart === -1) return null
  text = text.slice(objStart)

  try { return JSON.parse(text) } catch {}

  let repaired = text
    .replace(/,\s*"[^"]*"?\s*:\s*"[^"]*$/, '')
    .replace(/,\s*$/, '')

  let openBraces = 0, openBrackets = 0, inString = false, escape = false
  for (let i = 0; i < repaired.length; i++) {
    const c = repaired[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') openBraces++
    if (c === '}') openBraces--
    if (c === '[') openBrackets++
    if (c === ']') openBrackets--
  }
  if (inString) repaired += '"'
  repaired = repaired.replace(/,\s*$/, '')
  while (openBrackets > 0) { repaired += ']'; openBrackets-- }
  while (openBraces > 0) { repaired += '}'; openBraces-- }

  try { return JSON.parse(repaired) } catch {}
  return null
}
