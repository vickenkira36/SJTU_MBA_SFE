#!/usr/bin/env bash
# scripts/build-docx.sh — pandoc + post_process 一键生成 docs/thesis.docx
#
# 用法：
#   bash scripts/build-docx.sh

set -e

cd "$(dirname "$0")/.."

echo "→ pandoc: thesis.md → thesis.docx"
pandoc docs/thesis.md -o docs/thesis.docx \
    --reference-doc=docs/antai-template.docx \
    --lua-filter=docs/superscript-cite.lua \
    --resource-path=docs \
    --citeproc \
    --bibliography=docs/references.bib \
    --csl=docs/gb-t-7714-2015-numeric.csl \
    -f markdown -t docx

echo "→ post_process: 表格 AutoFit + 边框 + 防跨页 + 取消首行缩进"
python3 docs/post_process_docx.py docs/thesis.docx

echo "✓ docs/thesis.docx 已重新生成"
