// What the window keeps from one launch to the next: small choices and drafts, never a secret

export function readMark(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// null forgets the key
export function saveMark(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    return
  }
}
