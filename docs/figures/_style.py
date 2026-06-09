"""
论文图表统一视觉风格 —— 所有 matplotlib 图脚本共享此模块。

用法（脚本从仓库根运行，需先把本目录加进 sys.path）：

    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _style import *
    apply_style()

提供：字体探测 + rcParams、字号阶梯常量、统一调色板、中英文图注辅助。
风格基准为 fig3-3（11pt 起步、frameon=False 图例、中英双行图注）。

注：DPI 不在此写死——按 AGENTS.md 规则，生成后需用 DPI 校验脚本把图片宽度
调到 Word 中约 15cm（needed_dpi = max(150, int(px / 5.9))）。
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

# --- CJK 字体探测（合并各脚本原有列表的并集，优先简体）---
PREFERRED = ['Noto Sans CJK SC', 'Hiragino Sans GB', 'PingFang HK',
             'Heiti TC', 'STHeiti', 'Noto Sans CJK JP', 'Noto Sans CJK TC',
             'WenQuanYi Micro Hei', 'SimHei', 'Microsoft YaHei']
_available = {f.name for f in fm.fontManager.ttflist}
FONT_NAME = next((f for f in PREFERRED if f in _available), 'sans-serif')

# --- 字号阶梯（以 11pt 为基准，把原先偏小的 7-9pt 整体提上来）---
FS_AXIS_LABEL = 11   # 轴标题（年份 / 销售额…）
FS_TICK = 10         # 刻度数字
FS_DATA_LABEL = 10   # 柱顶 / 折线点数据标注
FS_LEGEND = 10       # 图例
FS_ANNOT = 9.5       # 次要标注 / 参考线说明 / 事件箭头
FS_CAPTION_CN = 10.5  # 中文图注 五号楷体（纲领要求）
FS_CAPTION_EN = 10.5  # 英文图注 五号

# --- 统一调色板 ---
C_PRIMARY = '#2c3e50'   # 主色 深蓝灰：所有数据柱主体
C_SECOND = '#7f8c8d'    # 次色 中灰：堆叠第二层 / As-Is 对照系列
C_TERTIARY = '#bdc3c7'  # 三色 浅灰：堆叠第三层
C_LINE = '#1f1f1f'      # 副轴折线 近黑（统一，替代原红线）
C_ACCENT = '#c0392b'    # 砖红：仅关键强调
C_TARGET = '#27ae60'    # 绿：仅目标 / 达标参考线
C_EVENT = '#2980b9'     # 蓝：事件标注箭头（少量）

GRID = dict(linestyle='--', alpha=0.3, color='gray')

RC = {
    'font.family': 'sans-serif',
    'font.sans-serif': [FONT_NAME] + PREFERRED + ['DejaVu Sans'],
    'font.size': 11,
    'axes.unicode_minus': False,
    'axes.edgecolor': 'black',
    'axes.linewidth': 0.8,
    'figure.facecolor': 'white',
    'axes.facecolor': 'white',
    'figure.dpi': 300,
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
    'savefig.facecolor': 'white',
}


def apply_style():
    """套用统一 rcParams。各脚本在画图前调用一次。"""
    plt.rcParams.update(RC)


# 图题中文楷体（纲领：图题中文五号楷体）。探测系统楷体字体名。
_KAI_PREFERRED = ['Kaiti SC', 'STKaiti', 'KaiTi', 'BiauKaiHK', 'Kai', '楷体']
_KAI_FONT = next((f for f in _KAI_PREFERRED if f in _available), FONT_NAME)


def add_caption(fig, cn, en):
    """在图底部加中英双行图注。
    纲领：图题中文五号楷体（不加粗），英文五号。中文编号+题名为楷体，
    英文行用默认西文字体。
    """
    fig.text(0.5, 0.02, cn, ha='center', fontsize=FS_CAPTION_CN,
             fontfamily=_KAI_FONT)
    fig.text(0.5, -0.025, en, ha='center', fontsize=FS_CAPTION_EN)
