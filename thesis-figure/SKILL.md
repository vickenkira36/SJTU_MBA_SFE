---
name: thesis-figure
description: >
  为上海交通大学MBA学位论文生成黑白学术风格图表。
  双工具链：Graphviz 用于结构/流程图，matplotlib 用于数据图表。
  支持：结构图、流程图、对比图、组织结构图、因果模型图、柱状图、条形图、饼图。
  触发词："画图"、"生成图表"、"流程图"、"柱状图"、"饼图"、"对比图"、"论文图表"。
---

# 论文图表生成器

为上海交通大学安泰MBA学位论文生成符合学术规范的黑白图表。
输出：源文件 + `.png` 渲染图片，存放于 `docs/figures/`。

## 双工具链

| 工具 | 适用场景 | 源文件 | 渲染命令 |
|------|---------|--------|---------|
| **Graphviz** | 结构图、流程图、组织图、因果模型 | `.dot` 文件 | `dot -Tpng file.dot -o file.png` |
| **Matplotlib** | 柱状图、条形图、饼图 | `.py` 脚本 | `python3 script.py` |

**选择规则：** 展示*数据数值*（百分比、对比）→ 用 matplotlib；展示*结构/流程/关系*（方框、箭头、层级）→ 用 Graphviz。

## 环境依赖

```bash
# Graphviz + 中文字体
which dot && dpkg -l fonts-noto-cjk 2>/dev/null | grep -q "^ii"
# Matplotlib
python3 -c "import matplotlib; print('OK')"
```

缺失时安装：
```bash
sudo apt-get install -y graphviz fonts-noto-cjk python3 python3-pip
pip3 install matplotlib --break-system-packages -q
```

## 文件命名规范

格式：`fig{章号}-{序号}.dot` 或 `.py` → `.png`

示例：`fig1-1.dot`、`fig4-3.py`、`fig5-2.dot`

## 工作流程

### 1. 确定图表类型

| 类型 | 工具 | 模板 | 适用场景 |
|------|------|------|---------|
| 瀑布结构图 | Graphviz | `assets/waterfall.dot` | 论文结构、分层流程、垂直管线 |
| 流程图 | Graphviz | `assets/flowchart.dot` | 算法步骤、判断分支、数据处理流程 |
| 对比图 | Graphviz | `assets/comparison.dot` | As-Is vs To-Be、前后对比 |
| 组织结构图 | Graphviz | `assets/org_chart.dot` | 公司架构、分类层级、系统分解 |
| 因果模型图 | Graphviz | `assets/causal_model.dot` | 变量关系、正负相关、理论模型 |
| 柱状图 | Matplotlib | `scripts/bar_chart.py` | 分类对比、带百分比标注 |
| 水平条形图 | Matplotlib | `scripts/horizontal_bar.py` | 重要性排序、因素对比 |
| 饼图 | Matplotlib | `scripts/pie_chart.py` | 比例分布、构成分析 |

### 2. 制作图表

**Graphviz 图表：**
1. 将模板 `.dot` 文件复制到 `docs/figures/figX-Y.dot`
2. 修改节点标签、边和布局
3. 遵循下方 **Graphviz 规则**

**Matplotlib 图表：**
1. 将模板 `.py` 脚本复制到 `docs/figures/figX-Y.py`
2. 修改配置区（DATA、CAPTION、OUTPUT_PATH）
3. 遵循下方 **Matplotlib 规则**

### 3. 渲染并验证

```bash
# Graphviz
dot -Tpng docs/figures/figX-Y.dot -o docs/figures/figX-Y.png

# Matplotlib
python3 docs/figures/figX-Y.py
```

查看 PNG 确认渲染效果。

### 4. 在章节 Markdown 中引用

```markdown
![图 X-Y 标题](figures/figX-Y.png)
```

## Graphviz 规则

已知问题详见 `references/graphviz-cjk-tips.md`。

### 全局设置（每个 dot 文件必须包含）

```dot
digraph G {
    rankdir=TB;
    dpi=300;
    bgcolor="white";
    fontname="Noto Sans CJK SC";
    nodesep=0.6;
    ranksep=0.35;

    node [fontname="Noto Sans CJK SC", shape=none, margin="0"];
    edge [color="black", penwidth=1.8, arrowsize=1.0];
```

### 中文居中对齐的解决方案

Graphviz 2.43.0 中 `BALIGN="CENTER"` 无效。多行文字必须用嵌套 `<TABLE>` 实现居中：

```dot
<!-- 错误写法：文字会左对齐 -->
<TD>第一行<BR/>第二行</TD>

<!-- 正确写法：每行独立居中 -->
<TD><TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0">
  <TR><TD ALIGN="CENTER"><FONT POINT-SIZE="10">第一行</FONT></TD></TR>
  <TR><TD ALIGN="CENTER"><FONT POINT-SIZE="10">第二行</FONT></TD></TR>
</TABLE></TD>
```

### 标题栏（黑底白字）

```dot
<TR><TD BORDER="1" BGCOLOR="black" CELLPADDING="8" WIDTH="280" ALIGN="CENTER">
    <FONT COLOR="white" POINT-SIZE="13"><B>标题</B></FONT>
</TD></TR>
```

### 子框（白底细边框）

```dot
<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="6" CELLPADDING="6">
    <TR>
        <TD WIDTH="130" ALIGN="CENTER"><!-- 内容 --></TD>
    </TR>
</TABLE>
```

### 图注节点（每张图底部必须有）

```dot
caption [label=<
    <TABLE BORDER="0" CELLBORDER="0" CELLSPACING="2" CELLPADDING="4">
        <TR><TD ALIGN="CENTER"><B><FONT POINT-SIZE="11">图 X-Y    中文标题</FONT></B></TD></TR>
        <TR><TD ALIGN="CENTER"><FONT POINT-SIZE="10">Figure X-Y  English Title</FONT></TD></TR>
    </TABLE>
>];
lastNode -> caption [style=invis];
```

### 字号规范

| 元素 | 字号 |
|------|------|
| 标题栏 | 13pt 加粗 |
| 子框文字 | 10pt |
| 中文图注 | 11pt 加粗 |
| 英文图注 | 10pt |
| 边标签 | 9pt |

### 配色方案

- 标题栏：`BGCOLOR="black"`，文字 `COLOR="white"`
- 子框：白底，`CELLBORDER="1"`
- 判断/中介节点：`#f0f0f0` 浅灰填充（可选）
- 所有边：黑色
- 背景：白色

## Matplotlib 规则

### 样式设置（每个脚本必须包含）

```python
# 自动检测系统中的中文字体（可能是 SC、JP 等）
CJK_FONTS = [f.name for f in fm.fontManager.ttflist if 'Noto Sans CJK' in f.name]
FONT_NAME = CJK_FONTS[0] if CJK_FONTS else 'sans-serif'

plt.rcParams.update({
    'font.sans-serif': [FONT_NAME, 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'SimHei'],
    'font.family': 'sans-serif',
    'font.size': 11,
    'axes.unicode_minus': False,
    'figure.facecolor': 'white',
    'axes.facecolor': 'white',
    'axes.edgecolor': 'black',
    'axes.linewidth': 0.8,
})
```

### 配色方案

仅使用灰度色，符合学术规范：
- 柱状图填充：`#404040`（深灰）、`#808080`（中灰）
- 饼图扇区：`plt.cm.gray(0.3 + 0.5 * i / (n-1))` 渐变
- 网格线：`color='gray', alpha=0.3, linestyle='--'`
- 所有文字：黑色

### 图表格式

- 隐藏上边框和右边框：`ax.spines['top'].set_visible(False)`
- 数值轴添加浅色网格
- 柱状图顶部显示数值标签（格式：`{:.1f}%` 或 `{:.0f}%`）
- 分辨率：300 DPI

### 图注（图表下方）

```python
fig.text(0.5, 0.02, "图 X-Y    中文标题", ha='center', fontsize=11, fontweight='bold')
fig.text(0.5, -0.02, "Figure X-Y  English Title", ha='center', fontsize=10)
plt.tight_layout(rect=[0, 0.06, 1, 1])
```

### 输出

```python
plt.savefig(OUTPUT_PATH, dpi=300, bbox_inches='tight', facecolor='white')
```

## 禁止事项

1. **禁止在 Graphviz 中用 `<BR/>` 实现多行居中** — 必须用嵌套表格方案。
2. **禁止使用 `shape=record`** — 不支持 HTML 标签和中文。
3. **禁止省略 `fontname="Noto Sans CJK SC"`** — 中文会显示为方框。
4. **禁止使用黑白灰以外的颜色** — 学术图表必须单色。
5. **禁止省略图注** — 每张论文图表必须有编号图注。
6. **禁止用 Graphviz 画数据图表** — 柱状图、饼图等用 matplotlib。
7. **禁止用 matplotlib 画结构图** — 方框箭头类用 Graphviz。
8. **禁止使用绝对路径** — 统一用项目根目录的相对路径。
