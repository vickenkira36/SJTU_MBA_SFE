---
name: thesis-docx
description: >
  将论文章节 Markdown 文件转换为符合上海交通大学安泰MBA学位论文格式规范的 Word (.docx) 文件。
  包含页面设置、标题样式、正文格式、引用上标、页眉等全部格式要求。
  触发词："生成docx"、"转Word"、"导出论文"、"格式转换"、"生成Word文档"。
---

# 论文 Word 文档生成器

将 `docs/chapterXX.md` 转换为符合安泰MBA论文格式规范的 `.docx` 文件。

## 核心命令

```bash
pandoc docs/chapterXX.md -o docs/chapterXX.docx \
  --reference-doc=docs/antai-template.docx \
  --resource-path=docs \
  --lua-filter=docs/superscript-cite.lua
```

## 环境依赖

```bash
which pandoc && python3 -c "from docx import Document; print('OK')"
```

缺失时安装：
```bash
sudo apt-get install -y pandoc
pip3 install python-docx --break-system-packages -q
```

## 格式规范（来源：安泰MBA论文格式样本.doc）

### 页面设置

| 项目 | 设置 |
|------|------|
| 纸张 | A4 (21cm × 29.7cm) |
| 上边距 | 3.5 厘米 |
| 下边距 | 4 厘米 |
| 左右边距 | 各 2.8 厘米 |
| 页眉距离 | 2.5 厘米 |
| 页脚距离 | 3 厘米 |
| 行距 | 全文 1.5 倍行距 |

### 页眉

- 左侧：`上海交通大学 MBA 学位论文`
- 右侧：论文简称
- 底部有细线分隔
- 字体：宋体 9pt

### 标题层级

| 层级 | 样式 | 字体 | 字号 | 对齐 | 其他 |
|------|------|------|------|------|------|
| 章标题（H1） | Heading 1 | 黑体加粗 | 三号 (16pt) | 居中 | 段前分页，大纲级别一 |
| 节标题（H2） | Heading 2 | 黑体加粗 | 四号 (14pt) | 左对齐 | 大纲级别二 |
| 小节标题（H3） | Heading 3 | 黑体加粗 | 小四 (12pt) | 左对齐 | 大纲级别三 |

### 正文

| 项目 | 设置 |
|------|------|
| 中文字体 | 宋体 |
| 英文字体 | Times New Roman |
| 字号 | 五号 (10.5pt) |
| 首行缩进 | 两个字符 (~21pt) |
| 行距 | 1.5 倍 |

### 图表格式

| 项目 | 设置 |
|------|------|
| 图题 | 五号楷体，居中，在图下方 |
| 英文图题 | 五号 Times New Roman |
| 表题 | 五号楷体，居中，在表上方 |
| 文献来源 | 小五号宋体居左 |
| 图表编号 | `图 X-Y`、`表 X-Y`（X为章号，Y为序号） |

### 公式

- 公式居中排列
- 编号右对齐，格式 `(X-Y)`

### 引用格式

| 场景 | 格式 | 示例 |
|------|------|------|
| 句末引用 | 上标 | `...压缩[1]。` → `[1]` 为上标 |
| 参考文献条目 | 正文大小 | `[1] 作者名. 标题...` → `[1]` 不上标 |

**禁止使用** `文献[N]可知` 等写法，影响行文流畅性。

### 参考文献

- 标题：三号黑体，加粗居中
- 条目格式：按 GB/T 7714 标准
- 编号 `[N]` 为正文大小，不上标
- 中英文文献混排

### 摘要/目录/附录/致谢

- 标题：三号黑体，加粗居中，字间空二格

## 关键文件

| 文件 | 作用 |
|------|------|
| `docs/antai-template.docx` | pandoc reference-doc 模板，定义所有样式 |
| `docs/superscript-cite.lua` | pandoc lua filter，处理引用上标 |
| `docs/create_template.py` | 模板生成脚本（修改格式时运行此脚本重建模板） |

## 模板生成/重建

当需要修改格式时，编辑 `docs/create_template.py` 后运行：

```bash
python3 docs/create_template.py
```

然后重新生成所有章节的 docx。

## 批量生成

```bash
for ch in chapter01 chapter02 chapter03; do
  pandoc "docs/${ch}.md" -o "docs/${ch}.docx" \
    --reference-doc=docs/antai-template.docx \
    --resource-path=docs \
    --lua-filter=docs/superscript-cite.lua
done
```

## Lua Filter 规则（superscript-cite.lua）

该 filter 自动处理引用编号的上标转换：

1. **正文中的 `[N]`** → 转为上标（句末引用）
2. **段落开头的 `[N]`** → 保持正文大小（参考文献条目）
3. **标题中** → 不处理（filter 只作用于 Para/Plain，不作用于 Header）

## Markdown 写作约定

为确保 pandoc 正确转换，Markdown 中需遵循以下约定：

1. **章标题**用一级标题：`# 第一章 绪论`
2. **节标题**用二级标题：`## 1.1 研究背景`
3. **小节标题**用三级标题：`### 1.1.1 详细内容`
4. **引用**直接写 `[N]`，filter 自动处理上标
5. **图片**用标准语法：`![图 X-Y 标题](figures/figX-Y.png)`
6. **公式**用 LaTeX 语法：`$$...$$`（块级）或 `$...$`（行内）
7. **参考文献**列表每条独立成段，以 `[N]` 开头

## 禁止事项

1. **禁止手动在 Markdown 中写上标语法** — 由 lua filter 自动处理。
2. **禁止使用旧模板** `public/F公司战略研究.docx` — 已替换为 `docs/antai-template.docx`。
3. **禁止省略 `--lua-filter` 参数** — 否则引用编号不会转为上标。
4. **禁止在标题中放引用编号** — 格式规范明确禁止。
5. **禁止使用"文献[N]可知"写法** — 影响行文流畅性。
