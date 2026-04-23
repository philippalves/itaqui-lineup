import fs from "fs/promises"
import pdf from "pdf-parse"

const STATUS_VALUES = ["ATRACADO", "FUNDEADO", "ESPERADO"]

function normalizeText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
}

function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim()
}

function isStatusStart(line) {
  return STATUS_VALUES.some((status) => line.startsWith(status + " "))
}

function shouldDropLine(line) {
  if (!line) return true

  const patterns = [
    /^\d{2}\/\d{2}\/\d{4}$/,
    /^Programação - LINE UP$/i,
    /^LEGENDA$/i,
    /^Berço$/i,
    /^Berços$/i,
    /^Berth/i,
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
    /^⚓- /,
    /^⊛ - /,
    /^1$/,
    /^Atualização:/i,
    /^Prof\.:/i,
    /^BERÇO \d+/i,
    /^Obs\.:/i
  ]

  return patterns.some((pattern) => pattern.test(line))
}

function rebuildLogicalLines(text) {
  const rawLines = normalizeText(text)
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !shouldDropLine(line))

  const logical = []
  let current = ""

  for (const line of rawLines) {
    if (isStatusStart(line)) {
      if (current) logical.push(current.trim())
      current = line
    } else {
      if (!current) continue
      current += " " + line
    }
  }

  if (current) logical.push(current.trim())

  return logical
}

function parseRecordLine(line) {
  const statusMatch = line.match(/^(ATRACADO|FUNDEADO|ESPERADO)\s+(.*)$/)
  if (!statusMatch) return null

  const status = statusMatch[1]
  const rest = statusMatch[2]

  const imoMatch = rest.match(/^(BL|\d{7})\s+(.*)$/)
  if (!imoMatch) {
    return {
      status,
      raw: line,
      parsed: {}
    }
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

  const numericMatches = [...afterVessel.matchAll(/\b\d{1,3},\d{1,2}\b|\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,6}\b/g)].map(m => m[0])

  const loa = numericMatches[0] || null
  const beam = numericMatches[1] || null
  const dwt = numericMatches[2] || null
  const arrivalDraft = numericMatches[3] || null
  const sailingDraft = numericMatches[4] || null

  return {
    status,
    raw: line,
    parsed: {
      imo,
      vessel,
      loa,
      beam,
      dwt,
      arrivalDraft,
      sailingDraft
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

  const logicalLines = rebuildLogicalLines(text)
  const records = logicalLines
    .map(parseRecordLine)
    .filter(Boolean)
    .map((record, index) => ({
      id: index + 1,
      ...record
    }))

  const payload = {
    sourcePage: discovered.sourcePage || "",
    sourcePdf: discovered.pdfUrl || "",
    updatedAt: new Date().toISOString(),
    totalPages: parsedPdf.numpages || null,
    totalTextLength: text.length,
    logicalLines,
    records
  }

  await fs.mkdir("data", { recursive: true })
  await fs.writeFile(
    "data/latest.json",
    JSON.stringify(payload, null, 2),
    "utf-8"
  )

  console.log(`Logical lines: ${logicalLines.length}`)
  console.log(`Records: ${records.length}`)
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
