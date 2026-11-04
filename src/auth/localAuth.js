// TEMPORARY auth that lives in the browser (localStorage) so you can build the UI
// before Supabase exists. It is NOT secure. Replace this file with Supabase Auth later,
// keeping the same function names so the rest of the app does not change.

const USERS_KEY = 'codedesk:users'
const SESSION_KEY = 'codedesk:session'
const PENDING_KEY = 'codedesk:pending-code'

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

const normalize = (email) => email.trim().toLowerCase()

async function hash(password) {
  const bytes = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function publicUser(email, record) {
  return { email, name: record.name, avatar: record.avatar || null }
}

/** Creates a 6-digit code. With no email service yet, the UI shows it on screen. */
export function sendCode(email) {
  const e = normalize(email)
  if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('Enter a valid email address first.')
  const code = String(Math.floor(100000 + Math.random() * 900000))
  write(PENDING_KEY, { email: e, code, expiresAt: Date.now() + 10 * 60 * 1000 })
  return code
}

function consumeCode(email, code) {
  const pending = read(PENDING_KEY, null)
  if (!pending || pending.email !== email) throw new Error('Request a verification code first.')
  if (Date.now() > pending.expiresAt) throw new Error('That code has expired. Request a new one.')
  if (pending.code !== code.trim()) throw new Error('Wrong verification code.')
  localStorage.removeItem(PENDING_KEY)
}

export async function register(email, password, code) {
  const e = normalize(email)
  const users = read(USERS_KEY, {})
  if (users[e]) throw new Error('This email is already registered. Please log in.')
  if (password.length < 6) throw new Error('Password must be at least 6 characters.')
  consumeCode(e, code)
  users[e] = { name: e.split('@')[0], passwordHash: await hash(password), avatar: null }
  write(USERS_KEY, users)
  write(SESSION_KEY, e)
  return publicUser(e, users[e])
}

export async function login(email, password, code) {
  const e = normalize(email)
  const users = read(USERS_KEY, {})
  const record = users[e]
  if (!record || record.passwordHash !== (await hash(password))) {
    throw new Error('Invalid email or password.')
  }
  consumeCode(e, code)
  write(SESSION_KEY, e)
  return publicUser(e, record)
}

export function getCurrentUser() {
  const e = read(SESSION_KEY, null)
  const record = e && read(USERS_KEY, {})[e]
  return record ? publicUser(e, record) : null
}

export function updateUser(email, patch) {
  const users = read(USERS_KEY, {})
  if (!users[email]) return null
  users[email] = { ...users[email], ...patch }
  write(USERS_KEY, users)
  return publicUser(email, users[email])
}

export function logout() {
  localStorage.removeItem(SESSION_KEY)
}
