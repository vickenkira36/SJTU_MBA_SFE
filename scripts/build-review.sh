#!/usr/bin/env bash
# scripts/build-review.sh — 生成可批注的 HTML 预览页 docs/thesis-review.html
#
# 用法：
#   bash scripts/build-review.sh
# 然后浏览器双击打开 docs/thesis-review.html，选中文字即可写批注，
# 批注自动存浏览器本地（localStorage），点"导出批注"得到 thesis-comments.json，
# 把该 json 发回，即可据此修改 thesis.md。

set -e
cd "$(dirname "$0")/.."

echo "→ pandoc: thesis.md → 正文 HTML 片段"
# 生成正文 HTML（带 section 包裹便于锚定 + 引用上标 + 图表）
pandoc docs/thesis.md \
    -t html \
    --citeproc \
    --bibliography=docs/references.bib \
    --csl=docs/gb-t-7714-2015-numeric.csl \
    --resource-path=docs \
    --mathjax \
    -o /tmp/thesis-body.html

echo "→ 组装批注模板 → docs/thesis-review.html"
python3 scripts/assemble-review-html.py /tmp/thesis-body.html docs/thesis-review.html

echo "✓ docs/thesis-review.html 已生成，浏览器打开即可批注"
