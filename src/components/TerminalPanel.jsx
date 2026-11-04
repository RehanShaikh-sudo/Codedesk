import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const SERVER_URL = import.meta.env.VITE_RUN_SERVER || 'ws://localhost:3001'

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
    term.writeln('Press \u25B6 Run to run the file that is open in the editor.')

    // Every key you type goes straight to the running program (like a real terminal)
    const keys = term.onData((data) => {
      const socket = socketRef.current
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Re-fit whenever the panel is resized, shown or hidden
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* panel is hidden */
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

  // Methods the parent (Workbench) can call
  useImperativeHandle(ref, () => ({
    run(file) {
      const term = termRef.current
      if (!term) return
      socketRef.current?.close()
      term.reset()
      term.writeln(`\x1b[36m$ Running ${file.name}\x1b[0m`)

      const socket = new WebSocket(SERVER_URL)
      socketRef.current = socket
      const isCurrent = () => socketRef.current === socket
      onRunningChange(true)

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'run', name: file.name, code: file.content }))
        term.focus()
      }
      socket.onmessage = (event) => {
        if (!isCurrent()) return
        const msg = JSON.parse(event.data)
        if (msg.type === 'data') {
          term.write(msg.data)
        } else if (msg.type === 'exit') {
          term.writeln(`\r\n\x1b[90m[Program finished with exit code ${msg.code}]\x1b[0m`)
          onRunningChange(false)
        } else if (msg.type === 'error') {
          term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`)
          onRunningChange(false)
        }
      }
      socket.onerror = () => {
        if (!isCurrent()) return
        term.writeln('\r\n\x1b[31mCannot reach the run server. Start it with: npm run server\x1b[0m')
        onRunningChange(false)
      }
      socket.onclose = () => {
        if (isCurrent()) onRunningChange(false)
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
        <button title="Stop the running program" onClick={() => socketRef.current?.close()}>
          Stop
        </button>
        <button title="Clear terminal" onClick={() => termRef.current?.clear()}>
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
