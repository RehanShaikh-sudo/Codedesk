// CodeDesk run server (hardened). Runs a student's file in a real terminal (pty) and streams it
// over a WebSocket. See the comments on each protection; the startup log shows which are active.
//
// Settings come from environment variables (all optional):
//   PORT, HOST                  where to listen (default 127.0.0.1:3001; the Dockerfile sets 0.0.0.0)
//   ALLOWED_ORIGINS             comma-separated website addresses allowed to connect, e.g. https://codedesk.pages.dev
//   RUN_AS_UID                  first of a block of unprivileged user IDs for student code, e.g. 20000 (each running program gets its
//                               own ID from the block 20000-20015). Only works if the server starts as root.
//   MAX_RUN_SECONDS (120)       hard time limit for one run
//   MAX_CONCURRENT (4)          programs running at the same time on this server
//   MAX_ACTIVE_PER_IP (2)       programs running at the same time per visitor
//   MAX_RUNS_PER_MINUTE (15)    runs per visitor per minute
//   TRUST_PROXY=1               use X-Forwarded-For for the visitor IP (set this behind Render / Cloudflare / nginx)
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, chown, chmod } from 'node:fs/promises'
import { mkdirSync, chmodSync, readdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

const env = process.env
const PORT = Number(env.PORT || 3001)
const HOST = env.HOST || '127.0.0.1'
const MAX_RUN_MS = Number(env.MAX_RUN_SECONDS || 120) * 1000
const MAX_CONCURRENT = Number(env.MAX_CONCURRENT || 4)
const MAX_ACTIVE_PER_IP = Number(env.MAX_ACTIVE_PER_IP || 2)
const MAX_RUNS_PER_MINUTE = Number(env.MAX_RUNS_PER_MINUTE || 15)
const MAX_CODE_BYTES = 100 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_INPUT_BYTES = 1024
const TRUST_PROXY = env.TRUST_PROXY === '1'
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
const ALLOW_NO_ORIGIN = env.ALLOW_NO_ORIGIN === '1' // only for command-line tests
const RUN_AS_UID = env.RUN_AS_UID ? Number(env.RUN_AS_UID) : null
if (RUN_AS_UID !== null && !(RUN_AS_UID >= 1000)) {
  console.error('RUN_AS_UID must be 1000 or higher (never root or a system user). Exiting.')
  process.exit(1)
}
const GOCACHE = env.GOCACHE || '/tmp/go-build-cache'

// extension -> shell command. f = file name, n = file name without extension
const RUNNERS = {
  py: (f) => `python3 -u "${f}"`,
  js: (f) => `node "${f}"`,
  java: (f, n) => `javac -J-Xmx256m "${f}" && java -Xmx256m -cp . ${n}`,
  c: (f) => `gcc "${f}" -o prog -lm && ./prog`,
  cpp: (f) => `g++ "${f}" -o prog && ./prog`,
  go: (f) => `go run "${f}"`,
  rs: (f) => `rustc "${f}" -o prog && ./prog`,
  rb: (f) => `ruby "${f}"`,
  php: (f) => `php "${f}"`,
  sh: (f) => `bash "${f}"`,
}

// Python's built-in pty module gives the program a real terminal (echo, prompts, Ctrl+C)
const PTY_WRAPPER = 'import pty,sys; sys.exit(pty.spawn(sys.argv[1:]) >> 8)'

// ---- Which protections are available on this machine? ----
const HAS_PRLIMIT = spawnSync('prlimit', ['--version']).status === 0
const CAN_DROP_PRIVILEGES = typeof process.getuid === 'function' && process.getuid() === 0 && RUN_AS_UID !== null
try {
  mkdirSync(GOCACHE, { recursive: true })
  chmodSync(GOCACHE, 0o1777)
} catch {
  /* not fatal */
}

function originAllowed(origin) {
  if (!origin) return ALLOW_NO_ORIGIN
  if (ALLOWED_ORIGINS.length > 0) return ALLOWED_ORIGINS.includes(origin)
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) // default: local development only
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for']
    if (forwarded) return String(forwarded).split(',')[0].trim()
  }
  return req.socket.remoteAddress || 'unknown'
}

// The program gets a clean environment: your secrets (database keys etc.) are never passed on
function childEnv(dir, token) {
  return {
    CODEDESK_RUN: token, // lets us find and stop every process that belongs to this run
    PATH: env.PATH,
    HOME: dir,
    TMPDIR: dir,
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    PYTHONDONTWRITEBYTECODE: '1',
    GOCACHE,
    GOPATH: path.join(dir, 'go'),
  }
}

// ---- Stopping everything a run started (even programs that hide in the background) ----
// With RUN_AS_UID every run has its own user ID, so "kill all processes of that user" is exact.
function sweepByUid(uid, gid) {
  for (let i = 0; i < 2; i++) {
    spawnSync('python3', ['-c', 'import os; os.kill(-1, 9)'], { uid, gid, timeout: 3000, stdio: 'ignore' })
  }
}
// Without it, find the run's processes by the token we put in their environment.
function sweepByToken(token) {
  let ids = []
  try {
    ids = readdirSync('/proc').filter((n) => /^\d+$/.test(n))
  } catch {
    return
  }
  for (const id of ids) {
    if (Number(id) === process.pid) continue
    try {
      if (readFileSync(`/proc/${id}/environ`, 'utf8').includes(token)) process.kill(Number(id), 'SIGKILL')
    } catch {
      /* not ours, or already gone */
    }
  }
}

// A pool of user IDs, handed out least-recently-used first. Reusing an ID right away can fail
// because processes that were just killed still count against that user until they are cleaned up.
const UID_POOL_SIZE = MAX_CONCURRENT * 4
const slotsInUse = new Set()
const slotFreedAt = new Array(UID_POOL_SIZE).fill(0)
function takeSlot() {
  let best = -1
  for (let i = 0; i < UID_POOL_SIZE; i++) {
    if (slotsInUse.has(i)) continue
    if (best === -1 || slotFreedAt[i] < slotFreedAt[best]) best = i
  }
  if (best >= 0) slotsInUse.add(best)
  return best
}

// ---- Usage tracking (limits abuse) ----
let activeRuns = 0
const activeByIp = new Map()
const recentRunsByIp = new Map()

function checkAllowed(ip) {
  if (activeRuns >= MAX_CONCURRENT) return 'The server is busy right now. Please try again in a few seconds.'
  if ((activeByIp.get(ip) || 0) >= MAX_ACTIVE_PER_IP) return 'You already have programs running. Stop one first.'
  const now = Date.now()
  const recent = (recentRunsByIp.get(ip) || []).filter((t) => now - t < 60_000)
  if (recent.length >= MAX_RUNS_PER_MINUTE) return 'Too many runs in a short time. Please wait a moment.'
  recent.push(now)
  recentRunsByIp.set(ip, recent)
  return null
}

setInterval(() => {
  const now = Date.now()
  for (const [ip, times] of recentRunsByIp) {
    const recent = times.filter((t) => now - t < 60_000)
    if (recent.length === 0) recentRunsByIp.delete(ip)
    else recentRunsByIp.set(ip, recent)
  }
}, 60_000).unref()

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('CodeDesk run server: ok\n')
  } else {
    res.writeHead(404)
    res.end()
  }
})

const wss = new WebSocketServer({
  server,
  maxPayload: 256 * 1024,
  verifyClient: (info, done) =>
    originAllowed(info.origin) ? done(true) : done(false, 403, 'Origin not allowed'),
})

wss.on('connection', (ws, req) => {
  const ip = clientIp(req)
  let started = false
  let slotTaken = false
  let child = null
  let dir = null
  let timer = null
  let sentBytes = 0
  let finished = false
  let capped = false
  let slot = -1
  let runUid = null
  let token = null

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
  }

  function stopEverything() {
    if (!child) return
    try {
      process.kill(-child.pid, 'SIGKILL') // the program's process group
    } catch {
      /* already gone */
    }
    // The terminal helper puts the program in its own session, so also sweep by user ID / token
    if (runUid !== null) sweepByUid(runUid, runUid)
    else if (token) sweepByToken(token)
  }

  // Used while a run is still active (time limit, output cap). After the run is finished its
  // user ID may already belong to the next run, so this must do nothing then.
  function killProcesses() {
    if (!finished) stopEverything()
  }

  async function finish() {
    // Must run only once: the user ID is handed to the next run as soon as the slot is released
    if (finished) return
    finished = true
    clearTimeout(timer)
    stopEverything()
    if (slotTaken) {
      slotTaken = false
      if (slot >= 0) {
        slotsInUse.delete(slot)
        slotFreedAt[slot] = Date.now()
      }
      activeRuns--
      activeByIp.set(ip, Math.max(0, (activeByIp.get(ip) || 1) - 1))
    }
    if (dir) {
      const d = dir
      dir = null
      await rm(d, { recursive: true, force: true }).catch(() => {})
    }
  }

  ws.on('message', async (raw, isBinary) => {
    if (isBinary) return
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg.type === 'input') {
      if (child && child.stdin.writable) child.stdin.write(String(msg.data ?? '').slice(0, MAX_INPUT_BYTES))
      return
    }
    if (msg.type !== 'run' || started) return
    started = true

    const name = String(msg.name || '')
    const code = String(msg.code ?? '')
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
    const runner = RUNNERS[ext]
    if (!/^[\w.-]{1,64}$/.test(name) || !runner) {
      send({ type: 'error', message: `Cannot run "${name}". Supported: ${Object.keys(RUNNERS).map((e) => '.' + e).join(' ')}` })
      return
    }
    if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
      send({ type: 'error', message: 'This file is too large to run (limit 100 KB).' })
      return
    }
    const refusal = checkAllowed(ip)
    if (refusal) {
      send({ type: 'error', message: refusal })
      return
    }
    slotTaken = true
    activeRuns++
    activeByIp.set(ip, (activeByIp.get(ip) || 0) + 1)
    slot = takeSlot()
    runUid = CAN_DROP_PRIVILEGES ? RUN_AS_UID + Math.max(slot, 0) : null
    token = randomBytes(8).toString('hex')

    try {
      dir = await mkdtemp(path.join(tmpdir(), 'codedesk-'))
      await chmod(dir, 0o700)
      const file = path.join(dir, name)
      await writeFile(file, code)
      if (CAN_DROP_PRIVILEGES) {
        await chown(dir, runUid, runUid)
        await chown(file, runUid, runUid)
      }
    } catch (err) {
      send({ type: 'error', message: 'Could not prepare the program.' })
      await finish()
      return
    }

    const base = name.slice(0, name.lastIndexOf('.'))
    // limits: 20 s of CPU per process, 256 processes, 50 MB files, 256 open files, no core dumps
    const limits = HAS_PRLIMIT
      ? ['prlimit', '--cpu=20', '--nproc=256', '--fsize=52428800', '--nofile=256', '--core=0', '--']
      : []
    const argv = [...limits, 'python3', '-c', PTY_WRAPPER, 'sh', '-c', runner(name, base)]

    child = spawn(argv[0], argv.slice(1), {
      cwd: dir,
      env: childEnv(dir, token),
      detached: true,
      ...(CAN_DROP_PRIVILEGES ? { uid: runUid, gid: runUid } : {}),
    })
    child.stdin.on('error', () => {})
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    const forward = (data) => {
      if (capped) return
      sentBytes += Buffer.byteLength(data)
      if (sentBytes > MAX_OUTPUT_BYTES) {
        capped = true
        send({ type: 'data', data: '\r\n[Stopped: too much output]\r\n' })
        killProcesses()
        return
      }
      send({ type: 'data', data })
    }
    child.stdout.on('data', forward)
    child.stderr.on('data', forward)
    child.on('error', (err) => {
      send({ type: 'error', message: `Could not start the program: ${err.message}` })
      finish()
    })
    child.on('close', async (code) => {
      send({ type: 'exit', code })
      await finish()
      ws.close()
    })

    timer = setTimeout(() => {
      send({ type: 'data', data: '\r\n[Stopped: time limit reached]\r\n' })
      killProcesses()
    }, MAX_RUN_MS)
  })

  ws.on('close', finish)
  ws.on('error', finish)
})

server.listen(PORT, HOST, () => {
  console.log(`Run server listening on ${HOST}:${PORT}`)
  console.log('Protections:')
  console.log(`  clean environment for programs ........ on`)
  console.log(`  time limit (${MAX_RUN_MS / 1000}s), output cap, size cap ... on`)
  console.log(`  run limits per visitor and overall ..... on`)
  console.log(`  origin check ........................... ${ALLOWED_ORIGINS.length ? 'on (' + ALLOWED_ORIGINS.join(', ') + ')' : 'local development only'}`)
  console.log(`  CPU/process/file limits (prlimit) ...... ${HAS_PRLIMIT ? 'on' : 'OFF (install util-linux)'}`)
  console.log(`  run code as unprivileged user .......... ${CAN_DROP_PRIVILEGES ? 'on (user IDs ' + RUN_AS_UID + '-' + (RUN_AS_UID + UID_POOL_SIZE - 1) + ', one per running program)' : 'OFF (start as root and set RUN_AS_UID to enable)'}`)
})
