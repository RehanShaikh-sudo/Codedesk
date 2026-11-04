import { useEffect, useRef, useState } from 'react'
import { startWorkbench, getActiveFile } from '../vscode/workbench'
import ProfileMenu from './ProfileMenu'
import TerminalPanel from './TerminalPanel'
import LanguageBar from './LanguageBar'

// `user` is null for guests. Guests can use everything except saving to the database.
export default function Workbench({ user, onLogout, onUserChange, onRequestLogin }) {
  const [running, setRunning] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelHeight, setPanelHeight] = useState(240)
  const [toast, setToast] = useState('')
  const terminalRef = useRef(null)

  const userKey = user ? user.email : 'guest'
  useEffect(() => {
    startWorkbench(userKey)
  }, [userKey])

  function showToast(text) {
    setToast(text)
    setTimeout(() => setToast(''), 3500)
  }

  function handleRun() {
    if (running) return
    setPanelOpen(true)
    const file = getActiveFile()
    requestAnimationFrame(() => {
      if (!file) {
        terminalRef.current?.message('Open a file in the editor first, then press Run.')
        return
      }
      terminalRef.current?.run(file)
    })
  }

  function handleSave() {
    if (!user) {
      onRequestLogin() // not logged in -> show the login / register popup
      return
    }
    // TODO (Supabase): upload this student's files to the database here.
    showToast('Saved in this browser. Saving to the online database will be added soon.')
  }

  return (
    <div className="workbench-root">
      <div className="titlebar-row">
        <div id="vscode-titlebar" />
        <div className="profile-slot">
          <button className="btn-run" onClick={handleRun} disabled={running}>
            {running ? 'Running…' : '▶ Run'}
          </button>
          <button className="btn-terminal" onClick={handleSave} title="Save your code to your account">
            ☁ Save
          </button>
          <button
            className="btn-terminal"
            onClick={() => setPanelOpen((v) => !v)}
            title="Show / hide terminal"
          >
            Terminal
          </button>
          {user ? (
            <ProfileMenu user={user} onLogout={onLogout} onUserChange={onUserChange} />
          ) : (
            <button className="btn-login" onClick={onRequestLogin}>
              Log in
            </button>
          )}
        </div>
      </div>

      <div id="vscode-main">
        <div id="vscode-left">
          <div id="vscode-activitybar" />
          <div id="vscode-sidebar" />
          <LanguageBar />
        </div>
        <div id="vscode-center">
          <div id="vscode-editors" />
          <TerminalPanel
            ref={terminalRef}
            height={panelHeight}
            hidden={!panelOpen}
            onResize={setPanelHeight}
            onClose={() => setPanelOpen(false)}
            onRunningChange={setRunning}
          />
        </div>
        <div id="vscode-right" />
      </div>

      <div id="vscode-statusbar" />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
