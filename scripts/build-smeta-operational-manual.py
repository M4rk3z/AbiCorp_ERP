from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "MANUAL_OPERATIVO_CHECKLIST_SMETA_ABICORP_BETA_1_2.md"
OUTPUT = ROOT / "output" / "pdf" / "MANUAL_OPERATIVO_CHECKLIST_SMETA_ABICORP_BETA_1_2.pdf"
LOGO = ROOT / "public" / "assets" / "abicorp-logo.png"

PAGE_W, PAGE_H = A4
GREEN = colors.HexColor("#064c3b")
GREEN_DARK = colors.HexColor("#02392e")
GREEN_SOFT = colors.HexColor("#eaf4ef")
LIME = colors.HexColor("#b9f34a")
INK = colors.HexColor("#102c26")
MUTED = colors.HexColor("#60716c")
LINE = colors.HexColor("#c8d8d2")
PAPER = colors.HexColor("#f7faf8")
AMBER = colors.HexColor("#e69a21")


def register_fonts() -> None:
    candidates = {
        "AbiSans": Path("C:/Windows/Fonts/arial.ttf"),
        "AbiSansBold": Path("C:/Windows/Fonts/arialbd.ttf"),
        "AbiSerif": Path("C:/Windows/Fonts/georgia.ttf"),
        "AbiSerifBold": Path("C:/Windows/Fonts/georgiab.ttf"),
        "AbiMono": Path("C:/Windows/Fonts/consola.ttf"),
    }
    fallback = {
        "AbiSans": "Helvetica",
        "AbiSansBold": "Helvetica-Bold",
        "AbiSerif": "Times-Roman",
        "AbiSerifBold": "Times-Bold",
        "AbiMono": "Courier",
    }
    for name, path in candidates.items():
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
        else:
            pdfmetrics.registerFontFamily(name, normal=fallback[name])


register_fonts()


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "CoverKicker", parent=base["Normal"], fontName="AbiSansBold", fontSize=9,
            leading=12, textColor=LIME, tracking=2, spaceAfter=12,
        ),
        "cover_title": ParagraphStyle(
            "CoverTitle", parent=base["Title"], fontName="AbiSerifBold", fontSize=30,
            leading=34, textColor=colors.white, spaceAfter=12,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle", parent=base["Normal"], fontName="AbiSans", fontSize=13,
            leading=19, textColor=colors.HexColor("#d9ece5"), spaceAfter=18,
        ),
        "cover_meta": ParagraphStyle(
            "CoverMeta", parent=base["Normal"], fontName="AbiSans", fontSize=9,
            leading=15, textColor=colors.white,
        ),
        "h1": ParagraphStyle(
            "H1", parent=base["Heading1"], fontName="AbiSerifBold", fontSize=19,
            leading=23, textColor=GREEN_DARK, spaceBefore=9, spaceAfter=8, keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading2"], fontName="AbiSerifBold", fontSize=13.5,
            leading=17, textColor=GREEN, spaceBefore=9, spaceAfter=5, keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["BodyText"], fontName="AbiSans", fontSize=8.8,
            leading=13, textColor=INK, spaceAfter=5,
        ),
        "small": ParagraphStyle(
            "Small", parent=base["BodyText"], fontName="AbiSans", fontSize=7.2,
            leading=9.4, textColor=INK,
        ),
        "small_bold": ParagraphStyle(
            "SmallBold", parent=base["BodyText"], fontName="AbiSansBold", fontSize=7.2,
            leading=9.4, textColor=colors.white,
        ),
        "bullet": ParagraphStyle(
            "Bullet", parent=base["BodyText"], fontName="AbiSans", fontSize=8.4,
            leading=12.2, textColor=INK, leftIndent=13, firstLineIndent=-11, spaceAfter=3,
        ),
        "quote": ParagraphStyle(
            "Quote", parent=base["BodyText"], fontName="AbiSans", fontSize=8.4,
            leading=12.3, textColor=GREEN_DARK, leftIndent=12, rightIndent=8,
            borderColor=LIME, borderWidth=0, borderPadding=8, backColor=GREEN_SOFT,
            spaceBefore=4, spaceAfter=8,
        ),
        "code": ParagraphStyle(
            "Code", parent=base["Code"], fontName="AbiMono", fontSize=7.5,
            leading=10.2, textColor=GREEN_DARK, leftIndent=9, rightIndent=9,
            borderPadding=8, backColor=GREEN_SOFT, spaceBefore=3, spaceAfter=8,
        ),
    }


STYLES = styles()


def inline_markup(text: str) -> str:
    value = html.escape(text.strip())
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"`([^`]+)`", r'<font name="AbiMono" color="#064c3b">\1</font>', value)
    return value


def page_chrome(canvas, doc) -> None:
    canvas.saveState()
    page = canvas.getPageNumber()
    if page == 1:
        canvas.setFillColor(GREEN_DARK)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        canvas.setFillColor(GREEN)
        canvas.circle(PAGE_W - 35 * mm, PAGE_H - 22 * mm, 52 * mm, fill=1, stroke=0)
        canvas.setStrokeColor(colors.HexColor("#2d7361"))
        canvas.setLineWidth(0.6)
        for offset in (0, 10, 20):
            canvas.circle(PAGE_W - 35 * mm, PAGE_H - 22 * mm, (30 + offset) * mm, fill=0, stroke=1)
        canvas.setFillColor(LIME)
        canvas.rect(0, 0, 7 * mm, PAGE_H, fill=1, stroke=0)
        canvas.setFont("AbiSans", 8)
        canvas.setFillColor(colors.HexColor("#b7d1c8"))
        canvas.drawString(24 * mm, 18 * mm, "Documento de operación y revisión funcional")
        canvas.drawRightString(PAGE_W - 18 * mm, 18 * mm, "BETA 1.2")
    else:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(16 * mm, PAGE_H - 14 * mm, PAGE_W - 16 * mm, PAGE_H - 14 * mm)
        canvas.setFont("AbiSansBold", 7.2)
        canvas.setFillColor(GREEN)
        canvas.drawString(16 * mm, PAGE_H - 10.5 * mm, "ABICORP ERP")
        canvas.setFont("AbiSans", 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(PAGE_W - 16 * mm, PAGE_H - 10.5 * mm, "Manual operativo y checklist SMETA | Beta 1.2")
        canvas.line(16 * mm, 14 * mm, PAGE_W - 16 * mm, 14 * mm)
        canvas.drawString(16 * mm, 9.5 * mm, "Derechos Reservados Fimma")
        canvas.drawRightString(PAGE_W - 16 * mm, 9.5 * mm, f"Página {page}")
    canvas.restoreState()


def table_widths(column_count: int, width: float):
    weights = {
        2: [0.34, 0.66],
        3: [0.18, 0.41, 0.41],
        4: [0.15, 0.41, 0.17, 0.27],
        5: [0.19, 0.22, 0.19, 0.18, 0.22],
        6: [0.09, 0.17, 0.27, 0.14, 0.16, 0.17],
        7: [0.07, 0.11, 0.25, 0.13, 0.16, 0.14, 0.14],
    }.get(column_count, [1 / column_count] * column_count)
    return [width * weight for weight in weights]


def build_table(rows, available_width):
    if not rows:
        return Spacer(1, 1)
    count = max(len(row) for row in rows)
    normalized = [row + [""] * (count - len(row)) for row in rows]
    data = []
    for row_index, row in enumerate(normalized):
        style = STYLES["small_bold"] if row_index == 0 else STYLES["small"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])
    table = Table(data, colWidths=table_widths(count, available_width), repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def parse_table(lines, start):
    rows = []
    index = start
    while index < len(lines) and lines[index].lstrip().startswith("|"):
        cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
        if not all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells):
            rows.append(cells)
        index += 1
    return rows, index


def markdown_story(text: str, available_width: float):
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith("## 1.")), 0)
    story = []
    paragraph = []
    index = start
    code_mode = False
    code_lines = []

    def flush_paragraph():
        if paragraph:
            story.append(Paragraph(inline_markup(" ".join(part.strip() for part in paragraph)), STYLES["body"]))
            paragraph.clear()

    while index < len(lines):
        line = lines[index].rstrip()
        stripped = line.strip()
        if stripped.startswith("```"):
            flush_paragraph()
            if code_mode:
                story.append(Preformatted("\n".join(code_lines), STYLES["code"]))
                code_lines = []
                code_mode = False
            else:
                code_mode = True
            index += 1
            continue
        if code_mode:
            code_lines.append(line)
            index += 1
            continue
        if not stripped:
            flush_paragraph()
            index += 1
            continue
        if stripped.startswith("|"):
            flush_paragraph()
            rows, index = parse_table(lines, index)
            story.append(build_table(rows, available_width))
            story.append(Spacer(1, 7))
            continue
        if stripped.startswith("## "):
            flush_paragraph()
            heading = stripped[3:]
            if heading.startswith(("7.", "8.", "10.")):
                story.append(PageBreak())
            story.append(Paragraph(inline_markup(heading), STYLES["h1"]))
            index += 1
            continue
        if stripped.startswith("### "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped[4:]), STYLES["h2"]))
            index += 1
            continue
        if stripped.startswith("> "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped[2:]), STYLES["quote"]))
            index += 1
            continue
        checkbox = re.match(r"^- \[ \] (.+)$", stripped)
        if checkbox:
            flush_paragraph()
            story.append(Paragraph(f'<font name="AbiSansBold" color="#064c3b">[ ]</font> {inline_markup(checkbox.group(1))}', STYLES["bullet"]))
            index += 1
            continue
        bullet = re.match(r"^- (.+)$", stripped)
        if bullet:
            flush_paragraph()
            story.append(Paragraph(f'<font color="#b9f34a">&#9679;</font> {inline_markup(bullet.group(1))}', STYLES["bullet"]))
            index += 1
            continue
        numbered = re.match(r"^(\d+)\. (.+)$", stripped)
        if numbered:
            flush_paragraph()
            story.append(Paragraph(f'<font name="AbiSansBold" color="#064c3b">{numbered.group(1)}.</font> {inline_markup(numbered.group(2))}', STYLES["bullet"]))
            index += 1
            continue
        paragraph.append(stripped)
        index += 1
    flush_paragraph()
    return story


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4,
        leftMargin=16 * mm, rightMargin=16 * mm,
        topMargin=20 * mm, bottomMargin=19 * mm,
        title="ABICORP ERP - Manual operativo y checklist SMETA",
        author="Fimma",
        subject="Guía de operación y revisión funcional SMETA de ABICorp Beta 1.2",
    )
    story = [Spacer(1, 25 * mm)]
    if LOGO.exists():
        logo = Image(str(LOGO), width=17 * mm, height=17 * mm)
        logo.hAlign = "LEFT"
        story.extend([logo, Spacer(1, 7 * mm)])
    story.extend([
        Paragraph("ABICORP ERP · BETA 1.2", STYLES["cover_kicker"]),
        Paragraph("Manual operativo y<br/>checklist de revisión SMETA", STYLES["cover_title"]),
        Paragraph("Guía práctica para operar el Centro de Gestión, el ERP y el Portal del colaborador, reunir evidencia y evaluar la cobertura funcional de 27 áreas de trabajo.", STYLES["cover_subtitle"]),
        Spacer(1, 7 * mm),
        Table([
            [Paragraph("VERSIÓN", STYLES["small_bold"]), Paragraph("FECHA", STYLES["small_bold"]), Paragraph("AMBIENTE", STYLES["small_bold"])],
            [Paragraph("2.0", STYLES["cover_meta"]), Paragraph("1 SEP 2026", STYLES["cover_meta"]), Paragraph("PRUEBAS", STYLES["cover_meta"])],
        ], colWidths=[42 * mm, 42 * mm, 42 * mm], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0b5d49")),
            ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#074535")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#2d7361")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#2d7361")),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ])),
        Spacer(1, 12 * mm),
        Paragraph("Referencia funcional: checklist_erp_rh_smeta_revision.pdf", STYLES["cover_meta"]),
        Paragraph("Derechos Reservados Fimma", STYLES["cover_meta"]),
        PageBreak(),
    ])
    story.extend(markdown_story(SOURCE.read_text(encoding="utf-8"), doc.width))
    doc.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
    print(OUTPUT)


if __name__ == "__main__":
    build()
