// Runs a single source file on a remote code-execution service (Judge0).
// To switch to your own server later, only change VITE_JUDGE0_URL (and VITE_JUDGE0_KEY).
const BASE_URL = (import.meta.env.VITE_JUDGE0_URL || 'https://ce.judge0.com').replace(/\/$/, '')
const API_KEY = import.meta.env.VITE_JUDGE0_KEY

// file extension -> Judge0 CE language (ids from Judge0 CE v1.13).
// If one fails, check the real list at: <BASE_URL>/languages
export const LANGUAGES = {
  py: { id: 71, label: 'Python 3' },
  js: { id: 63, label: 'JavaScript (Node.js)' },
  ts: { id: 74, label: 'TypeScript' },
  java: { id: 62, label: 'Java' },
  c: { id: 50, label: 'C (GCC)' },
  cpp: { id: 54, label: 'C++ (GCC)' },
  cc: { id: 54, label: 'C++ (GCC)' },
  cs: { id: 51, label: 'C# (Mono)' },
  go: { id: 60, label: 'Go' },
  rs: { id: 73, label: 'Rust' },
  rb: { id: 72, label: 'Ruby' },
  php: { id: 68, label: 'PHP' },
  kt: { id: 78, label: 'Kotlin' },
  swift: { id: 83, label: 'Swift' },
  r: { id: 80, label: 'R' },
  sh: { id: 46, label: 'Bash' },
  pl: { id: 85, label: 'Perl' },
  lua: { id: 64, label: 'Lua' },
  scala: { id: 81, label: 'Scala' },
  hs: { id: 61, label: 'Haskell' },
}

export function detectLanguage(fileName) {
  const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : ''
  return LANGUAGES[ext] || null
}

function toBase64(text) {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(b64) {
  if (!b64) return ''
  const binary = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function headers() {
  const h = { 'Content-Type': 'application/json' }
  if (API_KEY) h['X-Auth-Token'] = API_KEY
  return h
}

/**
 * @returns {Promise<{stdout:string, stderr:string, compileOutput:string, message:string,
 *                    statusId:number, status:string, time:string|null}>}
 */
export async function runCode({ language, source, stdin }) {
  const body = { source_code: toBase64(source), language_id: language.id }
  if (stdin) body.stdin = toBase64(stdin)

  const create = await fetch(`${BASE_URL}/submissions?base64_encoded=true&wait=false`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (create.status === 429) throw new Error('Too many runs right now. Wait a few seconds and try again.')
  if (!create.ok) throw new Error(`The run service returned an error (HTTP ${create.status}).`)
  const { token } = await create.json()

  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(attempt === 0 ? 600 : 1000)
    const poll = await fetch(`${BASE_URL}/submissions/${token}?base64_encoded=true&fields=*`, {
      headers: headers(),
    })
    if (!poll.ok) throw new Error(`Could not read the result (HTTP ${poll.status}).`)
    const data = await poll.json()
    // status 1 = in queue, 2 = processing; anything higher is finished
    if (data.status && data.status.id > 2) {
      return {
        stdout: fromBase64(data.stdout),
        stderr: fromBase64(data.stderr),
        compileOutput: fromBase64(data.compile_output),
        message: fromBase64(data.message),
        statusId: data.status.id,
        status: data.status.description,
        time: data.time,
      }
    }
  }
  throw new Error('The run took too long and was stopped.')
}
