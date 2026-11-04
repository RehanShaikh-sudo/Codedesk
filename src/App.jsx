import { useState } from 'react'
import { getCurrentUser, updateUser, logout } from './auth/localAuth'
import Login from './components/Login'
import Workbench from './components/Workbench'
import './App.css'

const GUEST_FILES_KEY = 'codedesk:files:guest'

export default function App() {
  const [user, setUser] = useState(() => getCurrentUser())
  // The login popup shows when the site opens (if not logged in), and can be closed
  const [loginOpen, setLoginOpen] = useState(() => !getCurrentUser())

  function handleAuth(newUser) {
    // Carry the guest's files over to the account (only if the account has no files yet)
    const guestFiles = localStorage.getItem(GUEST_FILES_KEY)
    const accountKey = `codedesk:files:${newUser.email}`
    if (guestFiles && !localStorage.getItem(accountKey)) {
      localStorage.setItem(accountKey, guestFiles)
    }
    // The workbench starts once per page load, so reload to open the account's files
    window.location.reload()
  }

  function handleLogout() {
    logout()
    window.location.reload()
  }

  function handleUserChange(patch) {
    setUser(updateUser(user.email, patch))
  }

  return (
    <>
      <Workbench
        user={user}
        onLogout={handleLogout}
        onUserChange={handleUserChange}
        onRequestLogin={() => setLoginOpen(true)}
      />
      {loginOpen && !user && <Login onAuth={handleAuth} onClose={() => setLoginOpen(false)} />}
    </>
  )
}
