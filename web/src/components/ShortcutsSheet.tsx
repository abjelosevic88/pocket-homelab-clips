import { mod } from '../lib/format'
import { Modal } from './ui'

const M = mod
const GROUPS: { title: string; keys: [string[], string][] }[] = [
  { title: 'Go to', keys: [[['1'], 'Search'], [['2'], 'Clipboard'], [['3'], 'Snippets'], [['4'], 'Quicklinks'], [[','], 'Settings'], [[M, 'K'], 'Search & commands'], [['/'], 'Search & commands']] },
  { title: 'New', keys: [[['n'], 'Snippet'], [['l'], 'Quicklink'], [['t'], 'Text clip'], [['i'], 'Image clip'], [[M, 'V'], 'Paste on the Clipboard page to add']] },
  { title: 'In a list', keys: [[['↑', '↓'], 'Move'], [['↵'], 'Copy, copy expanded or open'], [[M, '↵'], 'Open link · copy template · copy link'], [[M, 'P'], 'Pin or unpin'], [[M, 'E'], 'Edit a snippet or quicklink'], [[M, '⌫'], 'Delete a clip'], [['esc'], 'Clear the search']] },
  { title: 'Window', keys: [[['['], 'Show or hide the sidebar'], [['esc'], 'Close a dialog or menu'], [['?'], 'This sheet']] },
]

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} size="lg">
      <div className="shortcuts">
        {GROUPS.map(g => (
          <section key={g.title}>
            <h4 className="sc-h">{g.title}</h4>
            {g.keys.map(([keys, label]) => (
              <div key={label + keys.join('')} className="sc-row"><span>{label}</span><span className="sc-keys">{keys.map(k => <kbd key={k}>{k}</kbd>)}</span></div>
            ))}
          </section>
        ))}
      </div>
      <p className="muted small mt">The list keys work while the search box on a page has focus.</p>
    </Modal>
  )
}
