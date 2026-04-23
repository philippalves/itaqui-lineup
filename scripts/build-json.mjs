import fs from "fs/promises"
import pdf from "pdf-parse"

const STATUS_VALUES = ["ATRACADO", "FUNDEADO", "ESPERADO"]

function normalizeText(text) {
  return text.replace(/\u00a0/g, " ").replace(/\r/g, "")
}

function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim()
}

function isStatusOnly(line) {
  return STATUS_VALUES.includes(line)
}

function shouldDropLine(line) {
  if (!line) return true

  const patterns = [
    /^\d{2}\/\d{2}\/\d{4}$/,
    /^Programação - LINE UP$/i,
    /^LEGENDA$/i,
    /^Berço$/i,
    /^Berços$/i,
    /^Berth$/i,
    /^Status$/i,
    /^IMO$/i,
    /^Navio$/i,
    /^Vessel$/i,
    /^LOA$/i,
    /^Boca$/i,
    /^Beam$/i,
    /^DWT$/i,
    /^Calado de Chegada$/i,
    /^Calado de saída$/i,
    /^Arrival Draft/i,
    /^Sailing Draft/i,
    /^Prev\./i,
    /^ETA \/ NOR$/i,
    /^ETB$/i,
    /^ETS$/i,
    /^Oper$/i,
    /^ação$/i,
    /^Produto$/i,
    /^Cargo$/i,
    /^Qtde\.$/i,
    /^Agente/i,
    /^Agency$/i,
    /^Operador Portuário/i,
    /^Port Operator/i,
    /^Import\.\/Export\.$/i,
    /^OBSERVAÇÕES$/i,
    /^Remarks$/i,
    /^Atracados - Berthed/i,
    /^Fundeados - At Anchorage/i,
    /^Esperados - Forecasted/i,
    /^Manutenção$/i,
    /^Novo$/i,
    /^Editar$/i,
    /^Excluir$/i,
    /^Código do registro:/i,
    /^\* - /,
    /^# - /,
    /^⚓$/,
    /^⊛$/,
    /^1$/,
    /^Atualização:/i,
    /^Prof\.:/i,
    /^BERÇO \d+/i,
    /^Obs\.:/i
  ]

  return patterns.some((pattern) => pattern.test(line))
}

function cleanRawLines(text) {
  return normalizeText(text)
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !shouldDropLine(line))
}

function mergeBrokenLines(lines) {
  const merged = []

  for (const line of lines) {
    if (!merged.length) {
      merged.push(line)
      continue
    }

    const prev = merged[merged.length - 1]

    const joinWithoutSpace =
      /[\/.,-]$/.test(prev) ||
      /^[\/.,-]/.test(line) ||
      /^[0-9]{1,2}$/.test(line) ||
      /^[A-Z]{1,3}$/.test(line)

    const joinWithPrev =
      !isStatusOnly(line) &&
      (
        /^[,./:0-9]/.test(line) ||
        /^[A-Z]{1,4}$/.test(line) ||
        /^[a-z]/.test(line) ||
        /\/$/.test(prev) ||
        /,$/.test(prev) ||
        /\d$/.test(prev) && /^[.,]/.test(line)
      )

    if (joinWithoutSpace) {
      merged[merged.length - 1] = prev + line
    } else if (joinWithPrev) {
      merged[merged.length - 1] = prev + " " + line
    } else {
      merged.push(line)
    }
  }

  return merged
}

function buildLogicalLines(lines) {
  const logical = []
  let current = ""

  for (const line of lines) {
    if (isStatusOnly(line)) {
      if (current) logical.push(current.trim())
      current = line
      continue
    }

    if (!current) continue
    current += " " + line
  }

  if (current) logical.push(current.trim())

  return logical.map(normalizeLine)
}

function parseRecordLine(line) {
  const statusMatch = line.match(/^(ATRACADO|FUNDEADO|ESPERADO)\s+(.*)$/)
  if (!statusMatch) return null

  const status = statusMatch[1]
  const rest = statusMatch[2]

  const imoMatch = rest.match(/^(BL|\d{7})\s+(.*)$/)
  if (!imoMatch) {
    return { status, raw: line, parsed: {} }
  }

  const imo = imoMatch[1]
  const afterImo = imoMatch[2]

  const numStart = afterImo.search(/\s\d{1,3},\d{1,2}\s/)
  let vessel = null
  let afterVessel = afterImo

  if (numStart > 0) {
    vessel = afterImo.slice(0, numStart).trim()
    afterVessel = afterImo.slice(numStart).trim()
  }

  const numericMatches = [
    ...afterVessel.matchAll(/\b\d{1,3},\d{1,2}\b|\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,6}\b/g)
  ].map((m) => m[0])

  return {
    status,
    raw: line,
    parsed: {
      imo,
      vessel,
      loa: numericMatches[0] || null,
      beam: numericMatches[1] || null,
      dwt: numericMatches[2] || null,
      arrivalDraft: numericMatches[3] || null,
      sailingDraft: numericMatches[4] || null
    }
  }
}

async function main() {
  const pdfBuffer = await fs.readFile("downloads/latest.pdf")
  const discoveredRaw = await fs.readFile("data/discovered-pdf.json", "utf-8")
  const discovered = JSON.parse(discoveredRaw)

  const parsedPdf = await pdf(pdfBuffer)
  const text = parsedPdf.text || ""

  await fs.mkdir("downloads", { recursive: true })
  await fs.writeFile("downloads/latest.txt", text, "utf-8")

  const rawLines = cleanRawLines(text)
  const mergedLines = mergeBrokenLines(rawLines)
  const logicalLines = buildLogicalLines(mergedLines)

  const records = logicalLines
    .map(parseRecordLine)
    .filter(Boolean)
    .map((record, index) => ({
      id: index + 1,
      ...record
    }))

  const debug = {
    sourcePdf: discovered.pdfUrl || "",
    generatedAt: new Date().toISOString(),
    textLength: text.length,
    rawLinesCount: rawLines.length,
    mergedLinesCount: mergedLines.length,
    logicalLinesCount: logicalLines.length,
    recordsCount: records.length,
    logicalPreview: logicalLines.slice(0, 5)
  }

  const payload = {
    sourcePage: discovered.sourcePage || "",
    sourcePdf: discovered.pdfUrl || "",
    updatedAt: new Date().toISOString(),
    totalPages: parsedPdf.numpages || null,
    totalTextLength: text.length,
    rawLines,
    mergedLines,
    logicalLines,
    records
  }

  await fs.mkdir("data", { recursive: true })
  await fs.writeFile("data/latest-debug.json", JSON.stringify(debug, null, 2), "utf-8")
  await fs.writeFile("data/latest.json", JSON.stringify(payload, null, 2), "utf-8")

  console.log("TXT regenerated successfully")
  console.log(`Pages: ${parsedPdf.numpages || 0}`)
  console.log(`Raw lines: ${rawLines.length}`)
  console.log(`Merged lines: ${mergedLines.length}`)
  console.log(`Logical lines: ${logicalLines.length}`)
  console.log(`Records: ${records.length}`)
  console.log("Logical preview:")
  console.log(logicalLines.slice(0, 5).join("\n\n"))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
