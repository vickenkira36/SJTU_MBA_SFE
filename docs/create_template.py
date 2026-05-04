#!/usr/bin/env python3
"""
Create a pandoc reference-doc (.docx) template conforming to
SJTU Antai MBA thesis format requirements.

Strategy: Start from pandoc's own default reference doc (clean, no legacy numbering),
then override styles to match Antai format spec.
"""

import subprocess
import os
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml
from lxml import etree

# Step 1: Generate pandoc's default reference doc as base
# Use pandoc's built-in default reference doc which has all styles defined
result = subprocess.run(
    ['pandoc', '--print-default-data-file=reference.docx'],
    capture_output=True
)
with open('/tmp/pandoc-base.docx', 'wb') as f:
    f.write(result.stdout)

doc = Document('/tmp/pandoc-base.docx')

# Step 2: Remove ALL numbering definitions to eliminate bullet dots
numbering_part = doc.part.numbering_part
if numbering_part is not None:
    # Clear all abstractNum and num elements
    numbering_el = numbering_part._element
    for child in list(numbering_el):
        tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if tag in ('abstractNum', 'num'):
            numbering_el.remove(child)

# Step 3: Page setup
section = doc.sections[0]
section.top_margin = Cm(3.5)
section.bottom_margin = Cm(4)
section.left_margin = Cm(2.8)
section.right_margin = Cm(2.8)
section.header_distance = Cm(2.5)
section.footer_distance = Cm(3)
section.page_width = Cm(21)
section.page_height = Cm(29.7)

# Step 4: Header
header = section.header
header.is_linked_to_previous = False
hp = header.paragraphs[0]
hp.clear()

run_left = hp.add_run("上海交通大学 MBA 学位论文")
run_left.font.name = "宋体"
run_left.font.size = Pt(9)
run_left._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

hp.add_run("\t")

run_right = hp.add_run("运筹算法在制药企业SFE辖区动态分配中的应用及商业化研究")
run_right.font.name = "宋体"
run_right.font.size = Pt(9)
run_right._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

pPr = hp._element.get_or_add_pPr()
# Right-aligned tab at text width
text_width_twips = int((21 - 2.8 - 2.8) * 567)
tabs = parse_xml(
    f'<w:tabs {nsdecls("w")}>'
    f'  <w:tab w:val="right" w:pos="{text_width_twips}"/>'
    f'</w:tabs>'
)
pPr.append(tabs)

# Bottom border
pBdr = parse_xml(
    f'<w:pBdr {nsdecls("w")}>'
    f'  <w:bottom w:val="single" w:sz="4" w:space="1" w:color="000000"/>'
    f'</w:pBdr>'
)
pPr.append(pBdr)

# Step 5: Normal style (body text)
style_normal = doc.styles['Normal']
style_normal.font.name = 'Times New Roman'
style_normal.font.size = Pt(10.5)  # 五号
style_normal._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

pf = style_normal.paragraph_format
pf.line_spacing = 1.5
pf.space_before = Pt(0)
pf.space_after = Pt(0)
pf.first_line_indent = Pt(21)  # ~2 Chinese chars

# Step 6: Heading styles — clear any numPr and set fonts

def get_style_by_id(doc, style_id):
    """Get style by style_id (more reliable than by name in pandoc templates)."""
    for s in doc.styles:
        if s.style_id == style_id:
            return s
    raise KeyError(f"No style with id '{style_id}'")

def clean_heading(style, font_size_pt, bold, alignment, east_asia_font,
                  space_before_pt, space_after_pt, outline_level,
                  page_break_before=False):
    """Configure a heading style, removing any numbering."""
    # Font
    style.font.name = 'Times New Roman'
    style.font.size = Pt(font_size_pt)
    style.font.bold = bold
    style.font.color.rgb = None  # auto/black
    style._element.rPr.rFonts.set(qn('w:eastAsia'), east_asia_font)

    # Paragraph format
    pf = style.paragraph_format
    pf.alignment = alignment
    pf.line_spacing = 1.5
    pf.space_before = Pt(space_before_pt)
    pf.space_after = Pt(space_after_pt)
    pf.first_line_indent = Pt(0)
    pf.keep_with_next = True
    pf.page_break_before = page_break_before

    # Remove numPr if exists (kills the bullet dots)
    pPr = style._element.get_or_add_pPr()
    for numPr in pPr.findall(qn('w:numPr')):
        pPr.remove(numPr)

    # Set outline level
    for old in pPr.findall(qn('w:outlineLvl')):
        pPr.remove(old)
    pPr.append(parse_xml(
        f'<w:outlineLvl {nsdecls("w")} w:val="{outline_level}"/>'
    ))

# Heading 1: 三号黑体加粗居中 (16pt)
clean_heading(get_style_by_id(doc, 'Heading1'),
              font_size_pt=16, bold=True,
              alignment=WD_ALIGN_PARAGRAPH.CENTER,
              east_asia_font='黑体',
              space_before_pt=0, space_after_pt=24,
              outline_level=0, page_break_before=True)

# Heading 2: 四号黑体加粗 (14pt)
clean_heading(get_style_by_id(doc, 'Heading2'),
              font_size_pt=14, bold=True,
              alignment=WD_ALIGN_PARAGRAPH.LEFT,
              east_asia_font='黑体',
              space_before_pt=12, space_after_pt=6,
              outline_level=1)

# Heading 3: 小四号黑体加粗 (12pt)
clean_heading(get_style_by_id(doc, 'Heading3'),
              font_size_pt=12, bold=True,
              alignment=WD_ALIGN_PARAGRAPH.LEFT,
              east_asia_font='黑体',
              space_before_pt=6, space_after_pt=3,
              outline_level=2)

# Step 7: First Paragraph & Body Text — keep indent
for sid, sname in [('FirstParagraph', 'First Paragraph'), ('BodyText', 'Body Text')]:
    try:
        s = get_style_by_id(doc, sid)
    except KeyError:
        try:
            s = doc.styles[sname]
        except KeyError:
            s = doc.styles.add_style(sname, 1)
    s.base_style = style_normal
    s.paragraph_format.first_line_indent = Pt(21)

# Step 8: Also clean heading styles in the generated paragraphs
for p in doc.paragraphs:
    pPr = p._element.find(qn('w:pPr'))
    if pPr is not None:
        for numPr in pPr.findall(qn('w:numPr')):
            pPr.remove(numPr)

# Step 9: Save
output = 'docs/antai-template.docx'
doc.save(output)
os.remove('/tmp/pandoc-base.docx')
print(f"Template saved: {output}")
