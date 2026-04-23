import axios from "axios"
import fs from "fs/promises"

async function main() {
  const discoveredRaw = await fs.readFile("data/discovered-pdf.json", "utf-8")
  const discovered = JSON.parse(discoveredRaw)

  if (!discovered.pdfUrl) {
    throw new Error("Campo pdfUrl não encontrado em data/discovered-pdf.json")
  }

  const pdfUrl = discovered.pdfUrl

  console.log(`Baixando PDF: ${pdfUrl}`)

  const response = await axios.get(pdfUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ItaquiLineupBot/1.0)"
    }
  })

  const contentType = response.headers["content-type"] || ""
  console.log(`Content-Type recebido: ${contentType}`)

  await fs.mkdir("downloads", { recursive: true })
  await fs.writeFile("downloads/latest.pdf", Buffer.from(response.data))

  const metadata = {
    sourcePdf: pdfUrl,
    downloadedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(Buffer.from(response.data)),
    contentType
  }

  await fs.mkdir("data", { recursive: true })
  await fs.writeFile(
    "data/downloaded-pdf.json",
    JSON.stringify(metadata, null, 2),
    "utf-8"
  )

  console.log("PDF salvo em downloads/latest.pdf")
  console.log("Metadados salvos em data/downloaded-pdf.json")
}

main().catch((error) => {
  console.error("Erro ao baixar o PDF:")
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
