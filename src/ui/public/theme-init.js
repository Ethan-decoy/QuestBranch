// Blocking, same-origin bootstrap: choose the palette before CSS can paint.
;(() => {
  let mode = 'light'
  try {
    const saved = localStorage.getItem('questbranch-theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') mode = saved
  } catch {}
  const theme =
    mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : mode
  document.documentElement.dataset.themeMode = mode
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.documentElement.style.backgroundColor = theme === 'dark' ? '#101213' : '#f6f7f7'
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#101213' : '#f6f7f7')
})()
