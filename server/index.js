import express from 'express'
import cors from 'cors'
import multer from 'multer'
import archiver from 'archiver'
import { ZipFile } from 'yazl'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString, PDFNumber } from 'pdf-lib'
import path from 'path'
import { sanitizeBaseName, pickBackIndex } from './lib.js'

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(process.cwd(), 'public')))

const progressMap = new Map()
const listenersMap = new Map()

function isPng(buf) {
  return buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
}
function isJpg(buf) {
  return buf && buf.length > 2 && buf[0] === 0xFF && buf[1] === 0xD8
}

async function computeTargetSizeFromBack(backFile) {
  if ((backFile.mimetype || '').startsWith('application/pdf')) {
    try {
      const backPdf = await PDFDocument.load(backFile.buffer)
      const pages = backPdf.getPages()
      if (pages.length) {
        const s = pages[0].getSize()
        return { width: s.width, height: s.height }
      }
    } catch {}
  }
  return { width: 595.28, height: 841.89 }
}

async function embedImageAuto(out, file) {
  const buf = file.buffer
  const mt = file.mimetype || ''
  if (mt === 'image/png' || isPng(buf)) return out.embedPng(buf)
  if (mt === 'image/jpeg' || mt === 'image/jpg' || isJpg(buf)) return out.embedJpg(buf)
  throw new Error('Imagem deve ser PNG ou JPG')
}

function extractUriLinks(page) {
  const arr = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  const links = []
  if (!arr) return links
  for (let i = 0; i < arr.size(); i++) {
    const annot = arr.lookup(i, PDFDict)
    const subtype = annot.lookupMaybe(PDFName.of('Subtype'), PDFName)
    if (String(subtype) === '/Link') {
      const action = annot.lookupMaybe(PDFName.of('A'), PDFDict)
      if (action) {
        const s = action.lookupMaybe(PDFName.of('S'), PDFName)
        if (String(s) === '/URI') {
          const rect = annot.lookupMaybe(PDFName.of('Rect'), PDFArray)
          let urlStr
          const uriStr = action.lookupMaybe(PDFName.of('URI'), PDFString)
          if (uriStr) urlStr = uriStr.asString()
          else {
            const uriHex = action.lookupMaybe(PDFName.of('URI'), PDFHexString)
            if (uriHex) urlStr = uriHex.decodeText()
          }
          if (rect && urlStr) {
            const x1 = rect.get(0).asNumber()
            const y1 = rect.get(1).asNumber()
            const x2 = rect.get(2).asNumber()
            const y2 = rect.get(3).asNumber()
            links.push({ rectVals: [x1, y1, x2, y2], urlStr })
          }
        }
      }
    }
  }
  return links
}

function addScaledLinks(out, newPage, links, sx, sy) {
  let annots = newPage.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) {
    annots = out.context.obj([])
    newPage.node.set(PDFName.of('Annots'), annots)
  }
  for (const { rectVals, urlStr } of links) {
    const x1 = rectVals[0] * sx
    const y1 = rectVals[1] * sy
    const x2 = rectVals[2] * sx
    const y2 = rectVals[3] * sy
    const annotDict = out.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: out.context.obj([x1, y1, x2, y2]),
      Border: out.context.obj([0, 0, 0]),
      A: out.context.obj({ Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(urlStr) })
    })
    annots.push(annotDict)
  }
}

async function buildPdf(coverFile, journalPdf, backFile, target) {
  const out = await PDFDocument.create()

  const coverImg = await embedImageAuto(out, coverFile)
  const coverPage = out.addPage([target.width, target.height])
  coverPage.drawImage(coverImg, { x: 0, y: 0, width: target.width, height: target.height })

  const jIndices = journalPdf.getPageIndices()
  for (const jIdx of jIndices) {
    const jPage = journalPdf.getPage(jIdx)
    const links = extractUriLinks(jPage)
    const [embedded] = await out.embedPages([jPage])
    const page = out.addPage([target.width, target.height])
    page.drawPage(embedded, { x: 0, y: 0, width: target.width, height: target.height })
    const size = jPage.getSize()
    const sx = target.width / size.width
    const sy = target.height / size.height
    addScaledLinks(out, page, links, sx, sy)
  }

  if ((backFile.mimetype || '').startsWith('application/pdf')) {
    const backPdf = await PDFDocument.load(backFile.buffer)
    const bIndices = backPdf.getPageIndices()
    for (const bIdx of bIndices) {
      const bPage = backPdf.getPage(bIdx)
      const links = extractUriLinks(bPage)
      const [embedded] = await out.embedPages([bPage])
      const page = out.addPage([target.width, target.height])
      page.drawPage(embedded, { x: 0, y: 0, width: target.width, height: target.height })
      const size = bPage.getSize()
      const sx = target.width / size.width
      const sy = target.height / size.height
      addScaledLinks(out, page, links, sx, sy)
    }
  } else {
    const backImg = await embedImageAuto(out, backFile)
    const backPage = out.addPage([target.width, target.height])
    backPage.drawImage(backImg, { x: 0, y: 0, width: target.width, height: target.height })
  }

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
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
    if (covers.length < 1) return res.status(400).json({ error: 'Envie pelo menos uma Capa (PNG/JPG)' })
    if (backs.length < 1) return res.status(400).json({ error: 'Envie pelo menos uma Contracapa (PDF/PNG/JPG)' })

    const jobId = String(Date.now()) + '-' + Math.random().toString(36).slice(2)
    res.setHeader('x-job-id', jobId)

    const journalPdf = await PDFDocument.load(journal.buffer)

    const total = covers.length
    setProgress(jobId, { total, processed: 0 })

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="jornais-${new Date().toISOString().slice(0,10)}.zip"`)

    const zip = new ZipFile()
    zip.outputStream.on('error', () => {
      setProgress(jobId, { done: true })
      try { res.end() } catch {}
    })
    zip.outputStream.pipe(res)

    // Define o tamanho alvo com base na contracapa escolhida para este par
    for (let i = 0; i < covers.length; i++) {
      const cover = covers[i]
      const backIdx = pickBackIndex(i, covers.length, backs.length)
      const back = backs[backIdx]
      const target = await computeTargetSizeFromBack(back)
      const pdfBytes = await buildPdf(cover, journalPdf, back, target)
      const name = `${sanitizeBaseName(cover.originalname)} - ${sanitizeBaseName(journal.originalname)}.pdf`
      zip.addBuffer(Buffer.from(pdfBytes), name, { compress: true })
      setProgress(jobId, { processed: i + 1, total })
    }

    zip.end()
    setProgress(jobId, { done: true })
  } catch (err) {
    res.status(500).json({ error: 'Falha ao processar arquivos', details: String(err?.message || err) })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`)
})

export { }
