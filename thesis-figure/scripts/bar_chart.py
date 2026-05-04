#!/usr/bin/env python3
"""
Template: Vertical Bar Chart (柱状图)
Usage: Data comparison with percentage labels, category comparison.
Customize: Edit DATA, TITLE, XLABEL, YLABEL, CAPTION, OUTPUT_PATH below.

Style: Black-and-white academic, matching SJTU MBA thesis format.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import os

# ============================================================
# CONFIGURATION — Edit this section for each figure
# ============================================================

# Data: list of (label, value) tuples
DATA = [
    ("类别 A", 45.2),
    ("类别 B", 32.8),
    ("类别 C", 18.5),
    ("类别 D", 3.5),
]

TITLE = ""  # Leave empty for no title (caption is below the figure)
XLABEL = ""
YLABEL = "百分比 (%)"
SHOW_VALUE_LABELS = True       # Show value on top of each bar
VALUE_FORMAT = "{:.1f}%"       # Format string for value labels
FIGSIZE = (8, 5)               # (width, height) in inches
DPI = 300

# Caption (rendered below the chart)
CAPTION_CN = "图 X-Y    柱状图标题"
CAPTION_EN = "Figure X-Y  Bar Chart Title"

# Output
OUTPUT_PATH = "docs/figures/figX-Y.png"

# ============================================================
# STYLE — Normally no need to change
# ============================================================

# Find CJK font (may be SC, JP, etc. depending on system)
CJK_FONTS = [f.name for f in fm.fontManager.ttflist if 'Noto Sans CJK' in f.name]
FONT_NAME = CJK_FONTS[0] if CJK_FONTS else 'sans-serif'

plt.rcParams.update({
    'font.sans-serif': [FONT_NAME, 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'SimHei', 'sans-serif'],
    'font.family': 'sans-serif',
    'font.size': 11,
    'axes.unicode_minus': False,
    'figure.facecolor': 'white',
    'axes.facecolor': 'white',
    'axes.edgecolor': 'black',
    'axes.linewidth': 0.8,
    'xtick.color': 'black',
    'ytick.color': 'black',
    'text.color': 'black',
})

# ============================================================
# RENDERING
# ============================================================

labels = [d[0] for d in DATA]
values = [d[1] for d in DATA]

fig, ax = plt.subplots(figsize=FIGSIZE)

# Bars: black fill with white edge, or gray gradient
bars = ax.bar(labels, values, color='#404040', edgecolor='black', linewidth=0.8, width=0.5)

if SHOW_VALUE_LABELS:
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                VALUE_FORMAT.format(val),
                ha='center', va='bottom', fontsize=9)

if TITLE:
    ax.set_title(TITLE, fontsize=13, fontweight='bold', pad=12)
if XLABEL:
    ax.set_xlabel(XLABEL, fontsize=11)
if YLABEL:
    ax.set_ylabel(YLABEL, fontsize=11)

ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.yaxis.grid(True, linestyle='--', alpha=0.3, color='gray')
ax.set_axisbelow(True)

# Caption below
fig.text(0.5, 0.02, CAPTION_CN, ha='center', fontsize=11, fontweight='bold')
fig.text(0.5, -0.02, CAPTION_EN, ha='center', fontsize=10)

plt.tight_layout(rect=[0, 0.06, 1, 1])

os.makedirs(os.path.dirname(OUTPUT_PATH) or '.', exist_ok=True)
plt.savefig(OUTPUT_PATH, dpi=DPI, bbox_inches='tight', facecolor='white')
plt.close()
print(f"Saved: {OUTPUT_PATH}")
