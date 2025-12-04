import express from 'express'
import cors from 'cors'
import multer from 'multer'
import archiver from 'archiver'
import { PDFDocument } from 'pdf-lib'
import path from 'path'
import { sanitizeBaseName, pickBackIndex } from './lib.js'

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(process.cwd(), 'public')))

const progressMap = new Map()
const listenersMap = new Map()

async function computeTargetSize(journalPdf, backBuffers) {
  const jp = journalPdf.getPages()
  let maxW = jp.length ? jp[0].getSize().width : 595.28
  let maxH = jp.length ? jp[0].getSize().height : 841.89
  for (const p of jp) {
    const s = p.getSize()
    maxW = Math.max(maxW, s.width)
    maxH = Math.max(maxH, s.height)
  }
  for (const buf of backBuffers) {
    try {
      const backPdf = await PDFDocument.load(buf)
      for (const bp of backPdf.getPages()) {
        const s = bp.getSize()
        maxW = Math.max(maxW, s.width)
        maxH = Math.max(maxH, s.height)
      }
    } catch {}
  }
  return { width: maxW, height: maxH }
}

async function buildPdf(coverBuf, journalPdf, backPdfBytes, target) {
  const out = await PDFDocument.create()

  const coverImg = await out.embedPng(coverBuf)
  const coverPage = out.addPage([target.width, target.height])
  coverPage.drawImage(coverImg, { x: 0, y: 0, width: target.width, height: target.height })

  const journalCopies = await out.copyPages(journalPdf, journalPdf.getPageIndices())
  journalCopies.forEach(p => { out.addPage(p); p.setSize(target.width, target.height) })

  const backPdf = await PDFDocument.load(backPdfBytes)
  const backCopies = await out.copyPages(backPdf, backPdf.getPageIndices())
  backCopies.forEach(p => { out.addPage(p); p.setSize(target.width, target.height) })

  return await out.save()
}

function setProgress(jobId, data) {
  const prev = progressMap.get(jobId) || { processed: 0, total: 0, percent: 0, done: false }
  const next = { ...prev, ...data }
  next.percent = next.total > 0 ? Math.round((next.processed / next.total) * 100) : 0
  progressMap.set(jobId, next)
  const listeners = listenersMap.get(jobId) || []
  for (const res of listeners) {
    res.write(`event: progress\n`)
    res.write(`data: ${JSON.stringify({ processed: next.processed, total: next.total, percent: next.percent })}\n\n`)
    if (next.done) {
      res.write(`event: done\n`)
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
      res.end()
    }
  }
  if (next.done) {
    listenersMap.delete(jobId)
  }
}

app.get('/api/gerador/progresso', (req, res) => {
  const jobId = req.query.jobId
  if (!jobId) return res.status(400).json({ error: 'jobId é obrigatório' })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const list = listenersMap.get(jobId) || []
  list.push(res)
  listenersMap.set(jobId, list)
  const current = progressMap.get(jobId) || { processed: 0, total: 0, percent: 0, done: false }
  res.write(`event: progress\n`)
  res.write(`data: ${JSON.stringify({ processed: current.processed, total: current.total, percent: current.percent })}\n\n`)
})

app.post('/api/gerador', upload.fields([
  { name: 'covers', maxCount: 500 },
  { name: 'journal', maxCount: 1 },
  { name: 'backs', maxCount: 500 }
]), async (req, res) => {
  try {
    const covers = (req.files?.covers || [])
    const journal = (req.files?.journal || [])[0]
    const backs = (req.files?.backs || [])

    if (!journal) return res.status(400).json({ error: 'Arquivo do Jornal (.pdf) é obrigatório' })
    if (covers.length < 1) return res.status(400).json({ error: 'Envie pelo menos uma Capa (.png)' })
    if (backs.length < 1) return res.status(400).json({ error: 'Envie pelo menos uma Contracapa (.png)' })

    const jobId = String(Date.now()) + '-' + Math.random().toString(36).slice(2)
    res.setHeader('x-job-id', jobId)

    const journalPdf = await PDFDocument.load(journal.buffer)

    const total = covers.length
    setProgress(jobId, { total, processed: 0 })

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="jornais-${new Date().toISOString().slice(0,10)}.zip"`)

    const archive = archiver('zip', { zlib: { level: 9 } })
    archive.on('error', err => {
      setProgress(jobId, { done: true })
      res.status(500).end()
    })
    archive.pipe(res)

    const target = await computeTargetSize(journalPdf, backs.map(b => b.buffer))
    for (let i = 0; i < covers.length; i++) {
      const cover = covers[i]
      const backIdx = pickBackIndex(i, covers.length, backs.length)
      const back = backs[backIdx]
      const pdfBytes = await buildPdf(cover.buffer, journalPdf, back.buffer, target)
      const name = `${sanitizeBaseName(cover.originalname)} - ${sanitizeBaseName(journal.originalname)}.pdf`
      archive.append(Buffer.from(pdfBytes), { name })
      setProgress(jobId, { processed: i + 1, total })
    }

    archive.finalize().then(() => {
      setProgress(jobId, { done: true })
    }).catch(() => {
      setProgress(jobId, { done: true })
    })
  } catch (err) {
    res.status(500).json({ error: 'Falha ao processar arquivos', details: String(err?.message || err) })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`)
})

export { }
