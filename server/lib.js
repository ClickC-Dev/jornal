function sanitizeBaseName(name) {
  const base = name.replace(/\.[^/.]+$/, '')
  const cleaned = base.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned
}

function pickBackIndex(i, coversLen, backsLen) {
  if (backsLen === coversLen) return i
  if (backsLen === 1) return 0
  throw new Error('Quantidade de Contracapas não corresponde às Capas (deve ser 1 ou igual).')
}

export { sanitizeBaseName, pickBackIndex }
