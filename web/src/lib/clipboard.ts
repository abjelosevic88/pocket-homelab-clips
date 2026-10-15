/** Write text to the system clipboard; falls back to a hidden textarea on http or old browsers. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}
/** Copy an image (PNG only in most browsers); returns false when not supported. */
export async function copyImage(url: string): Promise<boolean> {
  try {
    if (!navigator.clipboard || !('ClipboardItem' in window)) return false
    const res = await fetch(url, { credentials: 'same-origin' })
    let blob = await res.blob()
    if (blob.type !== 'image/png') blob = await toPng(blob)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch { return false }
}
async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = bmp.width; c.height = bmp.height
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  return new Promise(res => c.toBlob(b => res(b!), 'image/png'))
}
