import fs from "fs/promises"
import pdf from "pdf-parse"

function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim()
}

function extractRowsFromText(text) {
  const lines = text
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)

  return lines.map((line, index) => ({
    id: index + 1,
    raw: line
  }))
}

async function main() {
  const pdfBuffer = await fs.readFile("downloads/latest.pdf")
  const discoveredRaw = await fs.readFile("data/discovered-pdf.json", "utf-8")
  const discovered = JSON.parse(discoveredRaw)

  const parsed = await pdf(pdfBuffer)
  const text = parsed.text || ""

  await fs.mkdir("downloads", { recursive: true })
  await fs.writeFile("downloads/latest.txt", text, "utf-8")

  const rows = extractRowsFromText(text)

  const payload = {
    sourcePage: discovered.sourcePage || "",
    sourcePdf: discovered.pdfUrl || "",
    updatedAt: new Date().toISOString(),
    totalPages: parsed.numpages || null,
    totalTextLength: text.length,
    rows
  }

  await fs.mkdir("data", { recursive: true })
  await fs.writeFile(
    "data/latest.json",
    JSON.stringify(payload, null, 2),
    "utf-8"
  )

  console.log("Texto extraído com sucesso.")
  console.log(`Páginas detectadas: ${parsed.numpages || 0}`)
  console.log(`Linhas extraídas: ${rows.length}`)
  console.log("Arquivo salvo em downloads/latest.txt")
  console.log("Arquivo salvo em data/latest.json")
}

main().catch((error) => {
  console.error("Erro ao gerar JSON a partir do PDF:")
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
