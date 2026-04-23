import fs from "fs/promises"
import pdf from "pdf-parse"

const STATUS_VALUES = ["ATRACADO", "FUNDEADO", "ESPERADO"]

function normalizeLine(line) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function shouldIgnoreLine(line) {
  if (!line) return true

  const ignoredPatterns = [
    /^Programação - LINE UP$/i,
    /^\d{2}\/\d{2}\/\d{4}$/i,
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
    /^Operador Portuário/i,
    /^Import\.\/Export\.$/i,
    /^OBSERVAÇÕES/i,
    /^Remarks$/i,
    /^LEGENDA$/i,
    /^Código do registro:/i,
    /^Atualização:/i,
    /^Atracados - Berthed$/i,
    /^Fundeados - At Anchorage$/i,
    /^Esperados - Forecasted$/i,
    /^Manutenção$/i,
    /^Novo$/i,
    /^Editar$/i,
    /^Excluir$/i,
    /^\* - /,
    /^# - /,
    /^⚓/,
    /^⊛/,
    /^\d+$/,
    /^Import\./i
  ]

  return ignoredPatterns.some((pattern) => pattern.test(line))
}

function cleanLines(text) {
  return text
    .split("\n")
    .map(normalizeLine)
    .filter((line) => !shouldIgnoreLine(line))
}

function isStatusLine(line) {
  return STATUS_VALUES.includes(line)
}

function looksLikeIMO(line) {
  return /^\d{7}$/.test(line)
}

function looksLikeDecimal(line) {
  return /^\d{1,3}(?:[.,]\d{1,2})$/.test(line)
}

function looksLikeIntegerWithThousands(line) {
  return /^\d{1,3}(?:\.\d{3})*(?:,\d+)?$/.test(line) || /^\d{4,6}$/.test(line)
}

function isLikelyVesselName(line) {
  if (!line) return false
  if (looksLikeIMO(line)) return false
  if (looksLikeDecimal(line)) return false
  if (looksLikeIntegerWithThousands(line)) return false
  if (STATUS_VALUES.includes(line)) return false
  if (line.length < 3) return false

  return /[A-Z]/.test(line)
}

function parseCoreFields(lines) {
  const result = {
    imo: null,
    vessel: null,
    loa: null,
    beam: null,
    dwt: null
  }

  const imoIndex = lines.findIndex((line) => looksLikeIMO(line))

  if (imoIndex === -1) {
    return result
  }

  result.imo = lines[imoIndex] || null

  for (let i = imoIndex + 1; i < lines.length; i++) {
    const line = lines[i]

    if (isLikelyVesselName(line)) {
      result.vessel = line
      break
    }
  }

  const numericCandidates = []

  for (let i = imoIndex + 1; i < lines.length; i++) {
    const line = lines[i]

    if (looksLikeDecimal(line) || looksLikeIntegerWithThousands(line)) {
      numericCandidates.push(line)
    }

    if (numericCandidates.length >= 5) break
  }

  if (numericCandidates[0]) result.loa = numericCandidates[0]
  if (numericCandidates[1]) result.beam = numericCandidates[1]
  if (numericCandidates[2]) result.dwt = numericCandidates[2]

  return result
}

function buildRecords(lines) {
  const records = []
  let current = null

  for (const line of lines) {
    if (isStatusLine(line)) {
      if (current) {
        records.push(current)
      }

      current = {
        status: line,
        lines: []
      }

      continue
    }

    if (!current) continue

    current.lines.push(line)
  }

  if (current) {
    records.push(current)
  }

  return records.map((record, index) => {
    const parsed = parseCoreFields(record.lines)

    return {
      id: index + 1,
      status: record.status,
      parsed,
      rawBlock: record.lines.join(" | "),
      lines: record.lines
    }
  })
}

async function main() {
  const pdfBuffer = await fs.readFile("downloads/latest.pdf")
  const discoveredRaw = await fs.readFile("data/discovered-pdf.json", "utf-8")
  const discovered = JSON.parse(discoveredRaw)

  const parsedPdf = await pdf(pdfBuffer)
  const text = parsedPdf.text || ""

  await fs.mkdir("downloads", { recursive: true })
  await fs.writeFile("downloads/latest.txt", text, "utf-8")

  const cleaned = cleanLines(text)
  const records = buildRecords(cleaned)

  const payload = {
    sourcePage: discovered.sourcePage || "",
    sourcePdf: discovered.pdfUrl || "",
    updatedAt: new Date().toISOString(),
    totalPages: parsedPdf.numpages || null,
    totalTextLength: text.length,
    cleanLines: cleaned,
    records
  }

  await fs.mkdir("data", { recursive: true })
  await fs.writeFile(
    "data/latest.json",
    JSON.stringify(payload, null, 2),
    "utf-8"
  )

  console.log("Texto extraído com sucesso.")
  console.log(`Páginas detectadas: ${parsedPdf.numpages || 0}`)
  console.log(`Linhas limpas: ${cleaned.length}`)
  console.log(`Registros detectados: ${records.length}`)
  console.log("Arquivo salvo em downloads/latest.txt")
  console.log("Arquivo salvo em data/latest.json")
}

main().catch((error) => {
  console.error("Erro ao gerar JSON a partir do PDF:")
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
