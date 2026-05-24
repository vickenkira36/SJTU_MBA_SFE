#!/usr/bin/env bash
# scripts/sync-from-docx.sh — 把 docs/thesis.docx 的手工改动反向同步到 docs/thesis.md
#
# 工作流：
#   用户在 Word 里直接改 thesis.docx → 跑此脚本 → 反向 pandoc 转出 /tmp/thesis-from-docx.md
#   → 与现有 docs/thesis.md 做 diff → 输出到 /tmp/thesis-sync.diff
#   → Claude 读 diff，识别"实质改动"vs"pandoc 反向噪声"，再 patch 到 thesis.md
#
# 用法：
#   bash scripts/sync-from-docx.sh
#
# 注意：
#   - markdown 不表达字体、字号、行间距等"纯样式"信息，这部分改动无法反向同步；
#     如需统一样式，请改 docs/antai-template.docx
#   - 反向 pandoc 输出的 markdown 风格与原 thesis.md 不完全一致（标题、引用、表格语法），
#     diff 里会含有大量"格式噪声"，需要 Claude 人在回路过滤

set -e

SRC_DOCX="docs/thesis.docx"
SRC_MD="docs/thesis.md"
TMP_MD="/tmp/thesis-from-docx.md"
DIFF_OUT="/tmp/thesis-sync.diff"
MEDIA_DIR="/tmp/thesis-from-docx-media"

if [ ! -f "$SRC_DOCX" ]; then
    echo "❌ 找不到 $SRC_DOCX"
    exit 1
fi

if [ ! -f "$SRC_MD" ]; then
    echo "❌ 找不到 $SRC_MD"
    exit 1
fi

# 时间戳对比：如果 thesis.md 比 thesis.docx 还新，说明上次是 markdown 端先改的，
# 这种情况下没有 docx 改动需要同步，提前提醒
if [ "$SRC_MD" -nt "$SRC_DOCX" ]; then
    echo "⚠ docs/thesis.md 比 docs/thesis.docx 还新——可能上次是从 md 端改的，"
    echo "   docx 端不一定有未同步的改动。要继续吗？(Ctrl+C 中止，回车继续)"
    read -r _
fi

echo "→ 反向 pandoc：$SRC_DOCX → $TMP_MD"
rm -rf "$MEDIA_DIR"
pandoc "$SRC_DOCX" \
    -o "$TMP_MD" \
    --wrap=none \
    --markdown-headings=atx \
    --extract-media="$MEDIA_DIR" 2>/dev/null

echo "→ 把已知"格式噪声"标准化（让 diff 聚焦实质内容）"
NORM_SRC="/tmp/thesis-norm-src.md"
NORM_TMP="/tmp/thesis-norm-tmp.md"

# 通用噪声清洗：
#   1. ------ → ——（em-dash 转 6 连字符）
#   2. ^\[N\]^ → ""（pandoc 引用上标）
#   3. [@key] → ""（原 md 引用键，让两边都没有引用）
#   4. 图片路径统一为 ![](IMG)
#   5. {.unnumbered} / {width=... height=...} 等属性去掉
#   6. \< \> \~ \[ \] 等转义还原
#   7. 表格分隔行（| 与 - + 等组成）整行去掉，让 grid / simple / pipe table 都被压成纯内容行
clean() {
    local in="$1" out="$2"
    sed -E \
        -e 's/------/——/g' \
        -e 's/(.)---(.)/\1——\2/g' \
        -e 's/\^\\\[[0-9,]+\\\]\^//g' \
        -e 's/\[@[a-zA-Z0-9_-]+(,[ ]*@[a-zA-Z0-9_-]+)*\]//g' \
        -e 's|!\[[^]]*\]\(figures/[^)]+\)|![](IMG)|g' \
        -e 's|!\[[^]]*\]\(/tmp/[^)]+\)\{[^}]*\}|![](IMG)|g' \
        -e 's|!\[[^]]*\]\([^)]+\)\{[^}]*\}|![](IMG)|g' \
        -e 's/[ ]*\{\.unnumbered\}//g' \
        -e 's/\\([<>~\[\]])/\1/g' \
        -e '/^[[:space:]]*[+|][-+|=:[:space:]]*$/d' \
        -e '/^[[:space:]]*[-]{3,}[-[:space:]]*$/d' \
        -e '/^[[:space:]]*[—]{3,}[—[:space:]]*$/d' \
        "$in" | \
    awk '/^[[:space:]]*$/{if(!blank){print;blank=1};next}{blank=0;print}' \
        > "$out"
}

clean "$SRC_MD" "$NORM_SRC"
clean "$TMP_MD" "$NORM_TMP"

echo "→ 与标准化后的 $SRC_MD 做 diff"
diff -u "$NORM_SRC" "$NORM_TMP" > "$DIFF_OUT" || true

DIFF_LINES=$(wc -l < "$DIFF_OUT" | tr -d ' ')
ADDED=$(grep -c '^+' "$DIFF_OUT" 2>/dev/null || echo 0)
REMOVED=$(grep -c '^-' "$DIFF_OUT" 2>/dev/null || echo 0)

echo ""
echo "=========================================="
echo "  反向同步结果"
echo "=========================================="
echo "  反向 md：       $TMP_MD"
echo "  diff 输出：     $DIFF_OUT"
echo "  diff 行数：     $DIFF_LINES"
echo "  新增行：        $ADDED"
echo "  删除行：        $REMOVED"
echo "=========================================="
echo ""
echo "下一步（Claude 执行）："
echo "  1. Read $DIFF_OUT，识别用户的实质改动 vs pandoc 反向噪声"
echo "  2. 把实质改动用 Edit 工具 patch 到 $SRC_MD"
echo "  3. 完成自己的新改动"
echo "  4. 跑 bash scripts/build-docx.sh 重新生成 docx"
