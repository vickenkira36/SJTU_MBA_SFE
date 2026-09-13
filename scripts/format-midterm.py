# -*- coding: utf-8 -*-
"""
scripts/format-midterm.py — 把中期检查报告的正文格式对齐已通过的开题报告

格式基准取自 开题报告/论文开题报告-陈一-124120935584.docx，其作者填写部分
（140 段）统一为：

    字体   华文楷体 12pt，不加粗（标题也不加粗，仅靠缩进区分层级）
    缩进   首行 2 字符（firstLineChars=200 / firstLine=480 twips）
    行距   1.25 倍（line=300, lineRule=auto）
    段前   156 twips ≈ 7.8pt，段后 0
    对齐   左对齐

只处理「报告正文」与「成果清单」两个作者填写区，学校模板自带的说明文字、
表头、承诺条款一律不动。就地改写格式属性，不触碰任何文字内容。

用法：python3 scripts/format-midterm.py [--dry-run]
"""

import shutil
import sys
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'docs' / '中期检查报告-陈一-124120935584.docx'

W = qn('w:p').rsplit('}', 1)[0] + '}'

# ── 开题报告的正文格式基准 ──
FONT_CJK = '华文楷体'
SIZE_HALF_PT = '24'        # 24 半磅 = 12pt
FIRST_LINE_CHARS = '200'   # 2 字符
FIRST_LINE_TWIPS = '480'
LINE = '300'               # 300/240 = 1.25 倍行距
SPACE_BEFORE = '156'
SPACE_AFTER = '0'

# 作者填写区的起止锚点（按文档顺序，锚点段本身不改）
REGIONS = [('报告正文', '成果清单'), ('成果清单', '本人承诺')]


def _sub(parent, tag):
    """取子元素，没有就新建并挂上。"""
    el = parent.find(W + tag)
    if el is None:
        el = OxmlElement('w:' + tag)
        parent.append(el)
    return el


def format_run(r):
    rPr = r.find(W + 'rPr')
    if rPr is None:
        rPr = OxmlElement('w:rPr')
        r.insert(0, rPr)
    rf = _sub(rPr, 'rFonts')
    rf.set(W + 'eastAsia', FONT_CJK)
    # 西文不指定，沿用模板默认（开题报告同此，ascii 为空）
    for tag in ('sz', 'szCs'):
        _sub(rPr, tag).set(W + 'val', SIZE_HALF_PT)
    # 开题报告正文不加粗，标题也不加粗
    for tag in ('b', 'bCs'):
        el = rPr.find(W + tag)
        if el is not None:
            rPr.remove(el)


def format_para(p):
    pPr = p.find(W + 'pPr')
    if pPr is None:
        pPr = OxmlElement('w:pPr')
        p.insert(0, pPr)
    ind = _sub(pPr, 'ind')
    ind.set(W + 'firstLineChars', FIRST_LINE_CHARS)
    ind.set(W + 'firstLine', FIRST_LINE_TWIPS)
    for attr in ('left', 'leftChars', 'hanging', 'hangingChars'):
        if ind.get(W + attr) is not None:
            del ind.attrib[W + attr]
    sp = _sub(pPr, 'spacing')
    sp.set(W + 'line', LINE)
    sp.set(W + 'lineRule', 'auto')
    sp.set(W + 'before', SPACE_BEFORE)
    sp.set(W + 'after', SPACE_AFTER)
    for attr in ('beforeLines', 'afterLines'):
        if sp.get(W + attr) is not None:
            del sp.attrib[W + attr]
    _sub(pPr, 'jc').set(W + 'val', 'left')
    for r in p.iter(W + 'r'):
        if ''.join(t.text or '' for t in r.iter(W + 't')).strip():
            format_run(r)


def text_of(el):
    return ''.join(t.text or '' for t in el.iter(W + 't')).strip()


def main():
    dry = '--dry-run' in sys.argv
    doc = Document(str(TARGET))
    kids = list(doc.element.body)

    touched = []
    for start_kw, end_kw in REGIONS:
        i = next((k for k, el in enumerate(kids)
                  if el.tag == W + 'p' and text_of(el).startswith(start_kw)), None)
        if i is None:
            print(f'  ⚠ 未找到锚点「{start_kw}」，跳过')
            continue
        for el in kids[i + 1:]:
            if el.tag != W + 'p':
                continue
            t = text_of(el)
            if t.startswith(end_kw):
                break
            if not t:
                continue
            if not dry:
                format_para(el)
            touched.append(t[:38])

    print(f'{"[dry-run] " if dry else ""}处理段落 {len(touched)} 段：')
    for t in touched[:4]:
        print(f'    {t}')
    print(f'    …')
    for t in touched[-2:]:
        print(f'    {t}')

    if dry:
        return
    bak = TARGET.with_suffix('.docx.bak')
    if not bak.exists():
        shutil.copy2(TARGET, bak)
        print(f'\n  已备份原件 → {bak.name}')
    doc.save(str(TARGET))
    print(f'\n✅ {TARGET.name} 格式已对齐开题报告')
    print(f'   华文楷体 12pt / 首行缩进 2 字符 / 1.25 倍行距 / 段前 7.8pt / 左对齐')


if __name__ == '__main__':
    main()
