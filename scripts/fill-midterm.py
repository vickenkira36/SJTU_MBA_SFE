# -*- coding: utf-8 -*-
"""
scripts/fill-midterm.py — 把中期检查报告正文填入学校模板

模板：硕士生中期检查-Mid-term+Exam+for+Master.docx
正文：docs/midterm-report-body.txt（纯文本，中文小标题 + 自然段，空行分段）
输出：docs/中期检查报告-陈一-124120935584.docx

模板里有三类需要特殊处理的控件：
  1. 两个 dropDownList 内容控件（学生类别 / 学习形式），带 sdtLocked + showingPlcHdr，
     需清除占位标记并写入选中项的 displayText；
  2. 六个 ☐ 复选框（研究课题来源），把「自拟课题」那个改为 ☑；
  3. 报告正文与成果清单是若干空段落，按需插入段落并复用相邻段落的样式。

用法：python3 scripts/fill-midterm.py
"""

import copy
import re
import shutil
from pathlib import Path

from docx import Document
from docx.shared import Pt

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / '硕士生中期检查-Mid-term+Exam+for+Master.docx'
BODY = ROOT / 'docs' / 'midterm-report-body.txt'
OUT = ROOT / 'docs' / '中期检查报告-陈一-124120935584.docx'

# ── 表头信息（取自已通过的开题报告 docs/论文开题报告-陈一-124120935584.pdf）──
FIELDS = {
    '学号': '124120935584',
    '姓名': '陈一',
    '导师': '葛冬冬',
    '专业': '工商管理（MBA）',
    '学院': '安泰经济与管理学院',
    '考核日期': '',                       # 作者手填
}
DROPDOWNS = {
    '学生类别': '专业型硕士生 Professional Master',
    '学习形式': '非全日制 Part-time',
}
TITLE = '运筹优化算法在药企 SFE 辖区分配中的应用研究'
PROPOSAL_DATE = '2026 年 2 月 24 日'
CHECKED_LABEL = '自拟课题'               # 研究课题来源勾选项
ACHIEVEMENTS = ('暂无。开题以来的阶段性工作产出为学位论文本身及其配套的算法实现与'
                '调研数据集，均未对外发表。')


def set_cell(cell, text):
    """写入单元格：保留首段样式，清掉多余段落。"""
    for p in cell.paragraphs[1:]:
        p._element.getparent().remove(p._element)
    p = cell.paragraphs[0]
    for r in p.runs[1:]:
        r._element.getparent().remove(r._element)
    if p.runs:
        p.runs[0].text = text
    else:
        r = p.add_run(text)
        r.font.size = Pt(14)


def fill_dropdown(doc, label, display):
    """填充 dropDownList 内容控件：清除占位符标记，写入选中项文本。"""
    for sdt in doc.element.body.iter(W + 'sdt'):
        items = [li.get(W + 'displayText') for li in sdt.iter(W + 'listItem')]
        if display not in items:
            continue
        pr = sdt.find(W + 'sdtPr')
        if pr is not None:
            for tag in ('showingPlcHdr', 'lock'):
                el = pr.find(W + tag)
                if el is not None:
                    pr.remove(el)
        content = sdt.find(W + 'sdtContent')
        ts = list(content.iter(W + 't'))
        if ts:
            ts[0].text = display
            for extra in ts[1:]:
                extra.text = ''
        return True
    return False


def check_box(doc, label):
    """把 label 对应的 ☐ 改成 ☑。"""
    for p in doc.element.body.iter(W + 'p'):
        ts = list(p.iter(W + 't'))
        joined = ''.join(t.text or '' for t in ts)
        if '☐' not in joined or label not in joined:
            continue
        # 该段可能含多个 ☐，只勾选紧邻 label 之前的那个
        pos = joined.find(label)
        before = joined[:pos]
        n_box = before.count('☐')          # 目标是第 n_box+1 个 ☐
        seen = 0
        for t in ts:
            if not t.text or '☐' not in t.text:
                continue
            out, local = [], t.text
            for ch in local:
                if ch == '☐':
                    seen += 1
                    out.append('☑' if seen == n_box + 1 else ch)
                else:
                    out.append(ch)
            t.text = ''.join(out)
            if seen > n_box:
                return True
    return False


def insert_body(doc, anchor_text, paragraphs, keep_blank=0):
    """在以 anchor_text 开头的段落之后，把 paragraphs 逐段写入随后的空段落；
    空段落不够时克隆最后一个空段补足。"""
    body = doc.element.body
    kids = list(body)
    start = None
    for i, el in enumerate(kids):
        if el.tag != W + 'p':
            continue
        txt = ''.join(t.text or '' for t in el.iter(W + 't')).strip()
        if txt.startswith(anchor_text):
            start = i
            break
    if start is None:
        raise SystemExit(f'未找到锚点段落：{anchor_text}')

    # 收集锚点之后的连续空段落
    blanks = []
    j = start + 1
    while j < len(kids) and kids[j].tag in (W + 'p', W + 'permEnd'):
        if kids[j].tag == W + 'permEnd':
            break
        txt = ''.join(t.text or '' for t in kids[j].iter(W + 't')).strip()
        if txt:
            break
        blanks.append(kids[j])
        j += 1
    if not blanks:
        raise SystemExit(f'锚点「{anchor_text}」后没有空段落可写入')

    usable = blanks[:len(blanks) - keep_blank] if keep_blank else blanks
    template_p = usable[0]

    # 需要的段落数超过现有空段时，克隆补足
    while len(usable) < len(paragraphs):
        new = copy.deepcopy(template_p)
        usable[-1].addnext(new)
        usable.append(new)

    for p_el, text in zip(usable, paragraphs):
        for r in list(p_el.iter(W + 'r')):
            r.getparent().remove(r)
        from docx.text.paragraph import Paragraph
        para = Paragraph(p_el, doc)
        run = para.add_run(text)
        run.font.size = Pt(12)
        para.paragraph_format.first_line_indent = Pt(24)
        para.paragraph_format.space_after = Pt(6)

    # 多余的空段落删掉
    for p_el in usable[len(paragraphs):]:
        p_el.getparent().remove(p_el)


def main():
    if not BODY.exists():
        raise SystemExit(f'正文文件不存在：{BODY}')
    text = BODY.read_text(encoding='utf-8').strip()
    paras = [re.sub(r'\s+', '', p) if len(p) < 40 else p.strip()
             for p in re.split(r'\n\s*\n', text) if p.strip()]

    doc = Document(str(TEMPLATE))

    # ── 表 1：基本信息 ──
    t1 = doc.tables[0]
    for row in t1.rows:
        key = row.cells[0].text.strip()
        for k, v in FIELDS.items():
            if key.startswith(k):
                set_cell(row.cells[1], v)
        for k, v in DROPDOWNS.items():
            if key.startswith(k):
                ok = fill_dropdown(doc, k, v)
                print(f'  下拉「{k}」→ {v} {"✓" if ok else "✗"}')

    # ── 表 2：论文题目 / 课题来源 / 开题日期 ──
    t2 = doc.tables[1]
    for row in t2.rows:
        key = row.cells[0].text.strip()
        if key.startswith('论文题目'):
            set_cell(row.cells[1], TITLE)
        elif key.startswith('论文开题日期'):
            set_cell(row.cells[1], PROPOSAL_DATE)
    print(f'  勾选「{CHECKED_LABEL}」 {"✓" if check_box(doc, CHECKED_LABEL) else "✗"}')

    # ── 正文与成果清单 ──
    insert_body(doc, '报告正文', paras)
    insert_body(doc, '成果清单', [ACHIEVEMENTS])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT))
    n_cn = len(re.findall(r'[一-鿿]', text))
    print(f'\n✅ {OUT}')
    print(f'   正文 {len(paras)} 段 / {n_cn:,} 汉字（学校要求 ≥4000）')


if __name__ == '__main__':
    main()
