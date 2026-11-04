import { useEffect, useRef, useState } from 'react'

export default function ProfileMenu({ user, onLogout, onUserChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const fileRef = useRef(null)

  // Close the menu when clicking anywhere outside it
  useEffect(() => {
    function close(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [])

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500 * 1024) {
      alert('Please choose an image smaller than 500 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => onUserChange({ avatar: reader.result })
    reader.readAsDataURL(file)
  }

  const initial = (user.name || user.email)[0].toUpperCase()
  const avatar = (size) =>
    user.avatar ? (
      <img src={user.avatar} alt="Profile" className={`avatar ${size}`} />
    ) : (
      <span className={`avatar ${size}`}>{initial}</span>
    )

  return (
    <div className="profile" ref={rootRef}>
      <button className="avatar-btn" onClick={() => setOpen((v) => !v)} title={user.email}>
        {avatar('sm')}
      </button>

      {open && (
        <div className="profile-menu">
          <div className="profile-head">
            {avatar('lg')}
            <div className="profile-info">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <button className="menu-item" onClick={() => fileRef.current.click()}>
            Change photo
          </button>
          <button className="menu-item danger" onClick={onLogout}>
            Log out
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handlePhoto} />
        </div>
      )}
    </div>
  )
}
