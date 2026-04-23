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
    const curr = line

    const appendNoSpace =
      /^[,./:;-]/.test(curr) ||
      /[\/.,:-]$/.test(prev) ||
      (/^\d{1,2}$/.test(curr) && /\d,\d$/.test(prev)) ||
      (/^[A-Z]{1,3}$/.test(curr) && /[A-Z]$/.test(prev))

    const appendWithSpace =
      !isStatusOnly(curr) &&
      (/^[A-Z]{1,4}$/.test(curr) || /^[a-z]/.test(curr) || /^\d{1,2}:\d{2}$/.test(curr))

    if (appendNoSpace) {
      merged[merged.length - 1] = prev + curr
    } else if (appendWithSpace) {
      merged[merged.length - 1] = prev + " " + curr
    } else {
      merged.push(curr)
    }
  }

  return merged
}

function repairCommonBreaks(lines) {
  return lines.map((line) =>
    line
      .replace(/32,2 9/g, "32,29")
      .replace(/(\d,\d)\s+(\d)\b/g, "$1$2")
      .replace(/(\d,\d{1})\s+(\d)\b/g, "$1$2")
      .replace(/(\d{1,2}\/\d{1,2})\s*\/\s*(\d{2}\s+\d{1,2}:\d{2})/g, "$1/$2")
      .replace(/(\d{1,2}\/\d{1,2})\s+(\d{2}\s+\d{1,2}:\d{2})/g, "$1/$2")
      .replace(/WILHELMSENG 5/g, "WILHELMSEN G5")
      .replace(/WILHELMSENG5/g, "WILHELMSEN G5")
      .replace(/TEGRAMLOU IS/g, "TEGRAM LOUIS")
      .replace(/TEGRAMA MAGGI/g, "TEGRAM AMAGGI")
      .replace(/TEGRAMCHS/g, "TEGRAM CHS")
      .replace(/TEGRAMADM/g, "TEGRAM ADM")
      .replace(/TEGRAMCOFCO/g, "TEGRAM COFCO")
      .replace(/VLIAGREX/g, "VLI AGREX")
      .replace(/VLICOFCO/g, "VLI COFCO")
      .replace(/COPIFERTGROW/g, "COPI FERTGROW")
      .replace(/FERTIPA R\//g, "FERTIPAR/")
      .replace(/SAL OBO/g, "SALOBO")
      .replace(/WILHE LMSEN/g, "WILHELMSEN")
      .replace(/WILSON SON S/g, "WILSON SONS")
      .replace(/TEGR AM/g, "TEGRAM")
      .replace(/TRA NSPETRO/g, "TRANSPETRO")
      .replace(/TRANSPE TRO/g, "TRANSPETRO")
      .replace(/PETROB RAS/g, "PETROBRAS")
      .replace(/AMA GGI/g, "AMAGGI")
      .replace(/MOS AIC/g, "MOSAIC")
      .replace(/BUN GE/g, "BUNGE")
      .replace(/LOU IS/g, "LOUIS")
      .replace(/CAR GILL/g, "CARGILL")
      .replace(/FERTIP AR/g, "FERTIPAR")
      .replace(/NML TANKE RS/g, "NML TANKERS")
      .replace(/LBH BRA SIL/g, "LBH BRASIL")
      .replace(/GRANEL QUÍM ICA/g, "GRANEL QUÍMICA")
      .replace(/QAV\/DIESEL\/GASOLI NA/g, "QAV/DIESEL/GASOLINA")
      .replace(/\bCalado de Chegada.*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
  )
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

function findOperationIndex(tokens) {
  return tokens.findIndex((t) => t === "C" || t === "D")
}

function findEtaIndex(tokens) {
  return tokens.findIndex((t, i) => {
    const next = tokens[i + 1]
    return /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(t) && next && /^\d{1,2}:\d{2}$/.test(next)
  })
}

function parseRecordLine(line) {
  const statusMatch = line.match(/^(ATRACADO|FUNDEADO|ESPERADO)\s+(.*)$/)
  if (!statusMatch) return null

  const status = statusMatch[1]
  const rest = statusMatch[2]
  const tokens = rest.split(" ")

  const imo = tokens[0] || null
  if (!imo) return null

  const etaIdx = findEtaIndex(tokens)
  const opIdx = findOperationIndex(tokens)

  let vessel = null
  let etaNor = null
  let etb = null
  let ets = null
  let operation = null
  let cargo = null

  if (etaIdx > 1) {
    vessel = tokens.slice(1, etaIdx - 4).join(" ").trim() || null
    etaNor = `${tokens[etaIdx]} ${tokens[etaIdx + 1]}`
    etb = tokens[etaIdx + 2] || null
    ets = tokens[etaIdx + 3] || null
  }

  if (opIdx !== -1) {
    operation = tokens[opIdx]
    const cargoStart = opIdx + 1
    const qtyIdx = tokens.findIndex((t, i) => i > cargoStart && /^\d{1,3}(?:\.\d{3})+$/.test(t))
    if (qtyIdx !== -1) {
      cargo = tokens.slice(cargoStart, qtyIdx).join(" ").trim() || null
    } else {
      cargo = tokens.slice(cargoStart).join(" ").trim() || null
    }
  }

  return {
    status,
    imo,
    vessel,
    etaNor,
    etb,
    ets,
    operation,
    cargo,
    raw: line
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
  const repairedLines = repairCommonBreaks(mergedLines)
  const logicalLines = buildLogicalLines(repairedLines)

  const records = logicalLines
    .map(parseRecordLine)
    .filter(Boolean)
    .map((record, index) => ({
      id: index + 1,
      ...record
    }))

  const simplified = records.map((r) => ({
    status: r.status,
    imo: r.imo,
    vessel: r.vessel,
    etaNor: r.etaNor,
    etb: r.etb,
    ets: r.ets,
    operation: r.operation,
    cargo: r.cargo
  }))

  const debug = {
    sourcePdf: discovered.pdfUrl || "",
    generatedAt: new Date().toISOString(),
    textLength: text.length,
    logicalLinesCount: logicalLines.length,
    recordsCount: records.length,
    preview: simplified.slice(0, 10)
  }

  const payload = {
    sourcePage: discovered.sourcePage || "",
    sourcePdf: discovered.pdfUrl || "",
    updatedAt: new Date().toISOString(),
    totalPages: parsedPdf.numpages || null,
    totalTextLength: text.length,
    records,
    simplified
  }

  await fs.mkdir("data", { recursive: true })
  await fs.writeFile("data/latest-debug.json", JSON.stringify(debug, null, 2), "utf-8")
  await fs.writeFile("data/latest.json", JSON.stringify(payload, null, 2), "utf-8")

  console.log(`Records: ${records.length}`)
  console.log(JSON.stringify(debug.preview, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
