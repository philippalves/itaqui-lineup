import axios from "axios"
import { load } from "cheerio"
import fs from "fs/promises"

const SOURCE_PAGE = "https://website.portodoitaqui.com.br/home"

function makeAbsoluteUrl(base, href) {
  return new URL(href, base).toString()
}

function scoreCandidate(url, text) {
  const value = `${url} ${text}`.toLowerCase()
  let score = 0

  if (value.includes(".pdf")) score += 50
  if (value.includes("mapa")) score += 20
  if (value.includes("atrac")) score += 20
  if (value.includes("line")) score += 10
  if (value.includes("clientes")) score += 5
  if (value.includes("porto")) score += 2

  return score
}

async function main() {
  console.log(`Acessando: ${SOURCE_PAGE}`)

  const response = await axios.get(SOURCE_PAGE, {
    timeout: 30000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ItaquiLineupBot/1.0)"
    }
  })

  const html = response.data
  const $ = load(html)

  const candidates = []

  $("a").each((_, el) => {
    const href = $(el).attr("href")
    const text = $(el).text().trim()

    if (!href) return

    let absoluteUrl
    try {
      absoluteUrl = makeAbsoluteUrl(SOURCE_PAGE, href)
    } catch {
      return
    }

    const joined = `${absoluteUrl} ${text}`.toLowerCase()

    const looksRelevant =
      joined.includes(".pdf") ||
      joined.includes("mapa") ||
      joined.includes("atrac") ||
      joined.includes("line")

    if (!looksRelevant) return

    candidates.push({
      href,
      text,
      absoluteUrl,
      score: scoreCandidate(absoluteUrl, text)
    })
  })

  console.log(`Candidatos encontrados: ${candidates.length}`)

  if (!candidates.length) {
    const debugPayload = {
      sourcePage: SOURCE_PAGE,
      foundAt: new Date().toISOString(),
      error: "Nenhum link candidato foi encontrado na página."
    }

    await fs.mkdir("data", { recursive: true })
    await fs.writeFile(
      "data/discovered-pdf.json",
      JSON.stringify(debugPayload, null, 2),
      "utf-8"
    )

    throw new Error("Nenhum link candidato foi encontrado na página.")
  }

  candidates.sort((a, b) => b.score - a.score)

  const best = candidates[0]

  const payload = {
    sourcePage: SOURCE_PAGE,
    pdfUrl: best.absoluteUrl,
    linkText: best.text,
    foundAt: new Date().toISOString(),
    candidatesFound: candidates.length,
    topCandidates: candidates.slice(0, 10)
  }

  await fs.mkdir("data", { recursive: true })
  await fs.writeFile(
    "data/discovered-pdf.json",
    JSON.stringify(payload, null, 2),
    "utf-8"
  )

  console.log("PDF encontrado com sucesso:")
  console.log(best.absoluteUrl)
  console.log("Arquivo salvo em data/discovered-pdf.json")
}

main().catch((error) => {
  console.error("Erro ao descobrir o PDF:")
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
