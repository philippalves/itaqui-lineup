import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber


STATUS_VALUES = ("ATRACADO", "FUNDEADO", "ESPERADO")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def clean_line(line: str) -> str:
    return normalize_spaces(line)


def starts_with_status(line: str) -> bool:
    return any(line.startswith(status + " ") for status in STATUS_VALUES)


def should_drop_line(line: str) -> bool:
    if not line:
        return True

    patterns = [
        r"^\d{2}/\d{2}/\d{4}$",
        r"^Programação - LINE UP$",
        r"^LEGENDA$",
        r"^Berço$",
        r"^Berços$",
        r"^Berth$",
        r"^Status$",
        r"^IMO$",
        r"^Navio$",
        r"^Vessel$",
        r"^LOA$",
        r"^Boca$",
        r"^Beam$",
        r"^DWT$",
        r"^Calado de Chegada$",
        r"^Calado de saída$",
        r"^Arrival Draft.*$",
        r"^Sailing Draft.*$",
        r"^Prev\..*$",
        r"^ETA / NOR$",
        r"^ETB$",
        r"^ETS$",
        r"^Oper$",
        r"^ação$",
        r"^Produto$",
        r"^Cargo$",
        r"^Qtde\.$",
        r"^Agente.*$",
        r"^Agency$",
        r"^Operador Portuário.*$",
        r"^Port Operator.*$",
        r"^Import\./Export\.$",
        r"^OBSERVAÇÕES$",
        r"^Remarks$",
        r"^Atracados - Berthed.*$",
        r"^Fundeados - At Anchorage.*$",
        r"^Esperados - Forecasted.*$",
        r"^Manutenção$",
        r"^Novo$",
        r"^Editar$",
        r"^Excluir$",
        r"^Código do registro:.*$",
        r"^\* - .*",
        r"^# - .*",
        r"^⚓- .*",
        r"^⊛ - .*",
        r"^⚓$",
        r"^⊛$",
        r"^1$",
        r"^Atualização:.*$",
        r"^Prof\.:.*$",
        r"^BERÇO \d+.*$",
        r"^Obs\.:.*$",
    ]

    return any(re.match(pattern, line, flags=re.IGNORECASE) for pattern in patterns)


def extract_pdf_text_lines(pdf_path: Path) -> list[str]:
    lines: list[str] = []

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            page_lines = [clean_line(line) for line in text.split("\n")]
            lines.extend(page_lines)

    return lines


def merge_broken_lines(lines: list[str]) -> list[str]:
    merged: list[str] = []

    for line in lines:
        if not line or should_drop_line(line):
            continue

        if not merged:
            merged.append(line)
            continue

        prev = merged[-1]
        curr = line

        if starts_with_status(curr):
            merged.append(curr)
            continue

        append_no_space = (
            re.match(r"^[,./:;-]", curr) is not None
            or re.search(r"[\/.,:-]$", prev) is not None
            or (re.match(r"^\d{1,2}$", curr) and re.search(r"\d,\d$", prev))
            or (re.match(r"^[A-Z]{1,3}$", curr) and re.search(r"[A-Z]$", prev))
        )

        append_with_space = (
            re.match(r"^[A-Z]{1,4}$", curr)
            or re.match(r"^[a-z]", curr)
            or re.match(r"^\d{1,2}:\d{2}$", curr)
            or re.match(r"^\d{1,2}/\d{1,2}$", curr)
            or re.match(r"^\d{1,2}/\d{1,2}/\d{2}$", curr)
        )

        if append_no_space:
            merged[-1] = prev + curr
        elif append_with_space:
            merged[-1] = prev + " " + curr
        else:
            merged[-1] = prev + " " + curr

    return [normalize_spaces(x) for x in merged if x.strip()]


def repair_common_breaks(line: str) -> str:
    repairs = [
        (r"32,2 9", "32,29"),
        (r"(\d,\d)\s+(\d)\b", r"\1\2"),
        (r"(\d,\d{1})\s+(\d)\b", r"\1\2"),
        (r"(\d{1,2}/\d{1,2})\s*/\s*(\d{2}\s+\d{1,2}:\d{2})", r"\1/\2"),
        (r"(\d{1,2}/\d{1,2})\s+(\d{2}\s+\d{1,2}:\d{2})", r"\1/\2"),
        (r"WILHELMSENG 5", "WILHELMSEN G5"),
        (r"WILHELMSENG5", "WILHELMSEN G5"),
        (r"TEGRAMLOU IS", "TEGRAM LOUIS"),
        (r"TEGRAMA MAGGI", "TEGRAM AMAGGI"),
        (r"TEGRAMCHS", "TEGRAM CHS"),
        (r"TEGRAMADM", "TEGRAM ADM"),
        (r"TEGRAMCOFCO", "TEGRAM COFCO"),
        (r"VLIAGREX", "VLI AGREX"),
        (r"VLICOFCO", "VLI COFCO"),
        (r"COPIFERTGROW", "COPI FERTGROW"),
        (r"FERTIPA R/", "FERTIPAR/"),
        (r"SAL OBO", "SALOBO"),
        (r"WILHE LMSEN", "WILHELMSEN"),
        (r"WILSON SON S", "WILSON SONS"),
        (r"TEGR AM", "TEGRAM"),
        (r"TRA NSPETRO", "TRANSPETRO"),
        (r"TRANSPE TRO", "TRANSPETRO"),
        (r"PETROB RAS", "PETROBRAS"),
        (r"AMA GGI", "AMAGGI"),
        (r"MOS AIC", "MOSAIC"),
        (r"BUN GE", "BUNGE"),
        (r"LOU IS", "LOUIS"),
        (r"CAR GILL", "CARGILL"),
        (r"FERTIP AR", "FERTIPAR"),
        (r"NML TANKE RS", "NML TANKERS"),
        (r"LBH BRA SIL", "LBH BRASIL"),
        (r"GRANEL QUÍM ICA", "GRANEL QUÍMICA"),
        (r"QAV/DIESEL/GASOLI NA", "QAV/DIESEL/GASOLINA"),
        (r"Calado de Chegada.*$", ""),
    ]

    out = line
    for pattern, repl in repairs:
        out = re.sub(pattern, repl, out)

    return normalize_spaces(out)


def build_logical_lines(lines: list[str]) -> list[str]:
    repaired = [repair_common_breaks(line) for line in lines]
    logical = [line for line in repaired if starts_with_status(line)]
    return logical


def find_eta_index(tokens: list[str]) -> int:
    for i in range(len(tokens) - 1):
        if re.match(r"^\d{1,2}/\d{1,2}/\d{2}$", tokens[i]) and re.match(r"^\d{1,2}:\d{2}$", tokens[i + 1]):
            return i
    return -1


def find_operation_index(tokens: list[str], start_idx: int) -> int:
    for i in range(start_idx, len(tokens)):
        if tokens[i] in {"C", "D"}:
            return i
    return -1


def is_numeric_token(token: str) -> bool:
    return (
        re.match(r"^\d{1,3},\d{1,2}$", token) is not None
        or re.match(r"^\d{1,3}(?:\.\d{3})+$", token) is not None
        or re.match(r"^\d{4,6}$", token) is not None
    )


def parse_record_line(line: str) -> dict | None:
    m = re.match(r"^(ATRACADO|FUNDEADO|ESPERADO)\s+(BL|\d{7})\s+(.*)$", line)
    if not m:
        return None

    status = m.group(1)
    imo = m.group(2)
    rest = m.group(3)
    tokens = rest.split(" ")

    eta_idx = find_eta_index(tokens)
    if eta_idx == -1:
        return {
            "status": status,
            "imo": imo,
            "vessel": rest,
            "etaNor": None,
            "etb": None,
            "ets": None,
            "operation": None,
            "cargo": None,
            "raw": line,
        }

    # Achar o início do bloco numérico antes do ETA:
    # vessel termina antes do primeiro token numérico do bloco LOA/Beam/DWT/Drafts
    vessel_end = 0
    for i in range(0, eta_idx):
        if is_numeric_token(tokens[i]):
            vessel_end = i
            break

    if vessel_end == 0:
        vessel = " ".join(tokens[: max(0, eta_idx - 5)]).strip() or None
    else:
        vessel = " ".join(tokens[:vessel_end]).strip() or None

    eta_nor = f"{tokens[eta_idx]} {tokens[eta_idx + 1]}" if eta_idx + 1 < len(tokens) else None
    etb = tokens[eta_idx + 2] if eta_idx + 2 < len(tokens) else None
    ets = tokens[eta_idx + 3] if eta_idx + 3 < len(tokens) else None

    op_idx = find_operation_index(tokens, eta_idx + 4)
    operation = tokens[op_idx] if op_idx != -1 else None

    cargo = None
    if op_idx != -1:
        cargo_start = op_idx + 1
        qty_idx = -1

        for i in range(cargo_start, len(tokens)):
            if re.match(r"^\d{1,3}(?:\.\d{3})+$", tokens[i]) or re.match(r"^\d{4,6}$", tokens[i]):
                qty_idx = i
                break

        if qty_idx != -1:
            cargo = " ".join(tokens[cargo_start:qty_idx]).strip() or None
        else:
            cargo = " ".join(tokens[cargo_start:]).strip() or None

    return {
        "status": status,
        "imo": imo,
        "vessel": vessel,
        "etaNor": eta_nor,
        "etb": etb,
        "ets": ets,
        "operation": operation,
        "cargo": cargo,
        "raw": line,
    }


def main() -> None:
    downloads_dir = Path("downloads")
    data_dir = Path("data")
    pdf_path = downloads_dir / "latest.pdf"
    discovered_path = data_dir / "discovered-pdf.json"

    discovered = json.loads(discovered_path.read_text(encoding="utf-8"))
    source_pdf = discovered.get("pdfUrl", "")

    raw_lines = extract_pdf_text_lines(pdf_path)
    merged_lines = merge_broken_lines(raw_lines)
    logical_lines = build_logical_lines(merged_lines)

    records = []
    for idx, line in enumerate(logical_lines, start=1):
        parsed = parse_record_line(line)
        if parsed:
            parsed["id"] = idx
            records.append(parsed)

    simplified = [
        {
            "status": r["status"],
            "imo": r["imo"],
            "vessel": r["vessel"],
            "etaNor": r["etaNor"],
            "etb": r["etb"],
            "ets": r["ets"],
            "operation": r["operation"],
            "cargo": r["cargo"],
        }
        for r in records
    ]

    debug = {
        "sourcePdf": source_pdf,
        "generatedAt": now_iso(),
        "rawLinesCount": len(raw_lines),
        "mergedLinesCount": len(merged_lines),
        "logicalLinesCount": len(logical_lines),
        "recordsCount": len(records),
        "preview": simplified[:10],
    }

    payload = {
        "sourcePdf": source_pdf,
        "updatedAt": now_iso(),
        "records": records,
        "simplified": simplified,
    }

    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "latest-debug.json").write_text(
        json.dumps(debug, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (data_dir / "latest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps(debug, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
