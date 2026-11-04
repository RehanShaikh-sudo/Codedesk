import { useState } from 'react'
import { LANGUAGE_LIST } from '../languages'
import { createFile } from '../vscode/workbench'

export default function LanguageBar() {
  const [broken, setBroken] = useState({}) // languages whose logo image failed to load

  async function handleClick(lang) {
    try {
      await createFile(lang.base, lang.ext, lang.template)
    } catch (err) {
      console.error('Could not create file', err)
    }
  }

  return (
    <div className="language-bar">
      {LANGUAGE_LIST.map((lang) => (
        <button
          key={lang.id}
          className="lang-btn"
          title={`New ${lang.label} file`}
          onClick={() => handleClick(lang)}
        >
          {broken[lang.id] ? (
            <span className="lang-fallback" style={{ background: lang.color }}>
              {lang.short}
            </span>
          ) : (
            <img
              src={lang.icon}
              alt={lang.label}
              onError={() => setBroken((b) => ({ ...b, [lang.id]: true }))}
            />
          )}
        </button>
      ))}
    </div>
  )
}
