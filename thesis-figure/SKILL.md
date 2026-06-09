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

### 统一样式：用 `docs/figures/_style.py` 公共模块

**所有 matplotlib 图脚本必须 import 公共样式模块**，不要各自重复定义字体/配色/
字号。脚本从仓库根运行，需先把脚本目录加进 sys.path：

```python
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _style import apply_style, add_caption, C_PRIMARY, C_SECOND, C_LINE, C_ACCENT, C_TARGET
import matplotlib.pyplot as plt
apply_style()   # 套用统一 rcParams（字体探测 + 11pt 基准 + 300 DPI）
```

### 配色方案（统一调色板，定义在 _style.py）

- `C_PRIMARY = '#2c3e50'` 深蓝灰 —— **所有数据柱主体统一用此主色**
- `C_SECOND = '#7f8c8d'` 中灰 —— 堆叠第二层 / As-Is 对照系列
- `C_TERTIARY = '#bdc3c7'` 浅灰 —— 堆叠第三层
- `C_LINE = '#1f1f1f'` 近黑 —— **双轴图的副轴折线统一用近黑**（不用彩色）
- `C_ACCENT = '#c0392b'` 砖红 —— 仅关键强调 / 阈值线
- `C_TARGET = '#27ae60'` 绿 —— 仅目标 / 达标参考线
- 网格线：`GRID`（`color='gray', alpha=0.3, linestyle='--'`）
- 多类别堆叠图可用主色起的同色系明度梯度区分类别

### 字号阶梯（_style.py 导出常量）

`FS_AXIS_LABEL=11 / FS_TICK=10 / FS_DATA_LABEL=10 / FS_LEGEND=10 / FS_ANNOT=9.5`
—— 数据标注不要小于 9.5pt，避免 Word 中看不清。

### 图表格式

- 隐藏上边框和右边框：`ax.spines['top'].set_visible(False)`
- 数值轴添加浅色网格
- 柱状图顶部数值标签；图例统一 `frameon=False`
- 柱顶若同时有"数值"与"增长率"两行标注，垂直间距至少拉开 ~2.7% 量程，避免重叠

### 图注（用 add_caption 辅助函数）

```python
add_caption(fig, "图 X-Y    中文标题", "Figure X-Y  English Title")
plt.tight_layout(rect=[0, 0.06, 1, 1])
```

### DPI（不在脚本里写死，生成后统一校验）

savefig 不要写 `dpi=200/220` 等显式值（继承 _style 的 300）。生成后按
本文 `图片 DPI 规则` 用校验脚本把宽度调到 Word 中约 15cm：
`needed_dpi = max(150, int(px / 5.9))`。

### 输出

```python
plt.savefig(OUTPUT_PATH, dpi=300, bbox_inches='tight', facecolor='white')
```

## 禁止事项

1. **禁止在 Graphviz 中用 `<BR/>` 实现多行居中** — 必须用嵌套表格方案。
2. **禁止使用 `shape=record`** — 不支持 HTML 标签和中文。
3. **禁止省略 `fontname="Noto Sans CJK SC"`** — 中文会显示为方框。
4. **禁止脱离统一调色板自创配色** — 必须用 `_style.py` 的 C_PRIMARY 等常量；主色统一 #2c3e50，副轴线近黑，红/绿仅作强调与目标线。
5. **禁止省略图注** — 每张论文图表必须有编号图注。
6. **禁止用 Graphviz 画数据图表** — 柱状图、饼图等用 matplotlib。
7. **禁止用 matplotlib 画结构图** — 方框箭头类用 Graphviz。
8. **禁止使用绝对路径** — 统一用项目根目录的相对路径。
