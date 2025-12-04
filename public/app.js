const steps = Array.from(document.querySelectorAll('#wizard .step'))
let coversFiles = []
let journalFile = null
let backsFiles = []

function showStep(n) {
  steps.forEach((el, i) => { el.hidden = i !== (n - 1) })
}

const coversInput = document.getElementById('covers')
const coversCount = document.getElementById('covers-count')
coversInput.addEventListener('change', () => {
  coversFiles = Array.from(coversInput.files || []).filter(f => f.type === 'image/png')
  coversCount.textContent = String(coversFiles.length)
})
document.getElementById('next-1').addEventListener('click', () => {
  if (coversFiles.length === 0) return
  showStep(2)
})

const journalInput = document.getElementById('journal')
const journalName = document.getElementById('journal-name')
journalInput.addEventListener('change', () => {
  const file = (journalInput.files || [])[0]
  if (file && file.type === 'application/pdf') {
    journalFile = file
    journalName.textContent = file.name
  } else {
    journalFile = null
    journalName.textContent = 'Nenhum arquivo selecionado'
  }
})
document.getElementById('prev-2').addEventListener('click', () => showStep(1))
document.getElementById('next-2').addEventListener('click', () => {
  if (!journalFile) return
  showStep(3)
})

const backsInput = document.getElementById('backs')
const backsCount = document.getElementById('backs-count')
backsInput.addEventListener('change', () => {
  backsFiles = Array.from(backsInput.files || []).filter(f => f.type === 'application/pdf')
  backsCount.textContent = String(backsFiles.length)
})
document.getElementById('prev-3').addEventListener('click', () => showStep(2))
document.getElementById('next-3').addEventListener('click', () => {
  if (backsFiles.length === 0) return
  generate()
})

const progressBar = document.getElementById('progress-bar')
const progressText = document.getElementById('progress-text')

async function generate() {
  showStep(4)
  const form = new FormData()
  coversFiles.forEach(f => form.append('covers', f))
  form.append('journal', journalFile)
  backsFiles.forEach(f => form.append('backs', f))

  const res = await fetch('/api/gerador', { method: 'POST', body: form })
  const jobId = res.headers.get('x-job-id')
  if (jobId) {
    const sse = new EventSource(`/api/gerador/progresso?jobId=${encodeURIComponent(jobId)}`)
    sse.addEventListener('progress', e => {
      try {
        const { percent } = JSON.parse(e.data)
        progressBar.style.width = `${percent}%`
        progressText.textContent = `${percent}%`
      } catch {}
    })
    sse.addEventListener('done', () => sse.close())
  }
  if (!res.ok) {
    alert('Falha ao gerar PDFs')
    showStep(3)
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.getElementById('download-link')
  link.href = url
  link.download = `jornais-${new Date().toISOString().slice(0,10)}.zip`
  showStep(5)
  launchConfetti()
}

document.getElementById('prev-4').addEventListener('click', () => {})
document.getElementById('restart').addEventListener('click', () => {
  coversFiles = []
  journalFile = null
  backsFiles = []
  coversInput.value = ''
  journalInput.value = ''
  backsInput.value = ''
  progressBar.style.width = '0%'
  progressText.textContent = '0%'
  showStep(1)
})

showStep(1)

function launchConfetti() {
  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.left = '0'
  canvas.style.top = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.pointerEvents = 'none'
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  const colors = ['#ff3366', '#ffd166', '#06d6a0', '#118ab2', '#8338ec']
  const pieces = []
  const count = 180
  for (let i = 0; i < count; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * canvas.height,
      w: 6 + Math.random() * 8,
      h: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vy: 2 + Math.random() * 4,
      vx: -2 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)]
    })
  }
  let start = null
  function tick(ts) {
    if (!start) start = ts
    const elapsed = ts - start
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const p of pieces) {
      p.x += p.vx
      p.y += p.vy
      p.rot += 0.03
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h)
      ctx.restore()
    }
    if (elapsed < 1500) {
      requestAnimationFrame(tick)
    } else {
      canvas.remove()
    }
  }
  requestAnimationFrame(tick)
}
