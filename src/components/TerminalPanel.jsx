import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// Normalize the WebSocket URL
function normalizeServerUrl(raw) {
  let url = String(raw || '').trim()

  // Remove accidental environment variable assignment
  url = url.replace(/^VITE_RUN_SERVER\s*=\s*/i, '')

  // Remove surrounding quotes
  url = url.replace(/^["']+|["']+$/g, '').trim()

  // Remove accidental duplicate protocol
  url = url.replace(/^wss\/\/+/i, '')
  url = url.replace(/^ws\/\/+/i, '')

  // Remove incorrect protocol prefixes
  url = url.replace(/^wws:\/\//i, 'wss://')
  url = url.replace(/^wss:\/\//i, 'wss://')

  if (!url) return 'ws://localhost:3001'

  if (/^https:\/\//i.test(url)) {
    url = 'wss://' + url.slice(8)
  } else if (/^http:\/\//i.test(url)) {
    url = 'ws://' + url.slice(7)
  } else if (!/^wss?:\/\//i.test(url)) {
    url = 'wss://' + url
  }

  return url.replace(/\/+$/, '')
}

const SERVER_URL = normalizeServerUrl(import.meta.env.VITE_RUN_SERVER)

const TerminalPanel = forwardRef(function TerminalPanel(
  { height, hidden, onResize, onClose, onRunningChange },
  ref
) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const socketRef = useRef(null)

  // Create the terminal once
  useEffect(() => {
    const term = new Terminal({
      fontSize: 14,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace",
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)

    termRef.current = term
    term.writeln('Press ▶ Run to run the file that is open in the editor.')

    // Send keyboard input to the running program
    const keys = term.onData((data) => {
      const socket = socketRef.current

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Resize terminal when panel changes
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // Panel may be hidden
      }
    })

    observer.observe(hostRef.current)

    return () => {
      keys.dispose()
      observer.disconnect()
      socketRef.current?.close()
      term.dispose()
    }
  }, [])

  // Methods called by Workbench
  useImperativeHandle(ref, () => ({
    run(file) {
      const term = termRef.current
      if (!term) return

      // Close any previous connection
      socketRef.current?.close()
      socketRef.current = null

      term.reset()
      term.writeln(`\x1b[36m$ Running ${file.name}\x1b[0m`)

      // Validate and open WebSocket connection
      let socket

      try {
        const url = new URL(SERVER_URL)

        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
          throw new Error('Invalid WebSocket protocol')
        }

        socket = new WebSocket(url.toString())
      } catch (error) {
        term.writeln('\r\n\x1b[31mInvalid run server address.\x1b[0m')
        term.writeln(`\x1b[90mConfigured address: ${SERVER_URL}\x1b[0m`)
        onRunningChange(false)
        return
      }

      socketRef.current = socket

      const isCurrent = () => socketRef.current === socket

      onRunningChange(true)

      socket.onopen = () => {
        if (!isCurrent()) return

        try {
          socket.send(
            JSON.stringify({
              type: 'run',
              name: file.name,
              code: file.content,
            })
          )

          term.focus()
        } catch (error) {
          term.writeln(`\r\n\x1b[31mCould not send code: ${error.message}\x1b[0m`)
          onRunningChange(false)
          socket.close()
        }
      }

      socket.onmessage = (event) => {
        if (!isCurrent()) return

        try {
          const msg = JSON.parse(event.data)

          if (msg.type === 'data') {
            if (typeof msg.data === 'string') {
              term.write(msg.data)
            }
          } else if (msg.type === 'exit') {
            term.writeln(
              `\r\n\x1b[90m[Program finished with exit code ${msg.code}]\x1b[0m`
            )
            onRunningChange(false)
          } else if (msg.type === 'error') {
            term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`)
            onRunningChange(false)
          }
        } catch (error) {
          term.writeln('\r\n\x1b[31mReceived an invalid response from the run server.\x1b[0m')
          console.error('Terminal WebSocket message error:', error)
          onRunningChange(false)
        }
      }

      socket.onerror = () => {
        if (!isCurrent()) return

        term.writeln('\r\n\x1b[31mCannot connect to the run server. Check its URL and WebSocket configuration.\x1b[0m')
        onRunningChange(false)
      }

      socket.onclose = (event) => {
        if (!isCurrent()) return

        onRunningChange(false)

        if (event.code !== 1000 && event.code !== 1005) {
          term.writeln(`\r\n\x1b[31mConnection closed (code ${event.code}).\x1b[0m`)
        }
      }
    },

    message(text) {
      termRef.current?.writeln(`\x1b[31m${text}\x1b[0m`)
    },
  }))

  function startDrag(e) {
    e.preventDefault()

    const startY = e.clientY
    const startHeight = height

    const move = (ev) => {
      const next = startHeight + (startY - ev.clientY)
      onResize(Math.max(110, Math.min(next, window.innerHeight * 0.7)))
    }

    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      document.body.style.userSelect = ''
    }

    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  return (
    <div className="terminal" style={{ height, display: hidden ? 'none' : 'flex' }}>
      <div className="terminal-resizer" onMouseDown={startDrag} />

      <div className="terminal-tabs">
        <button className="active">TERMINAL</button>
        <div className="spacer" />

        <button
          title="Stop the running program"
          onClick={() => socketRef.current?.close()}
        >
          Stop
        </button>

        <button
          title="Clear terminal"
          onClick={() => termRef.current?.clear()}
        >
          Clear
        </button>

        <button title="Close terminal" onClick={onClose}>
          {'\u2715'}
        </button>
      </div>

      <div className="terminal-host" ref={hostRef} />
    </div>
  )
})

export default TerminalPanel
