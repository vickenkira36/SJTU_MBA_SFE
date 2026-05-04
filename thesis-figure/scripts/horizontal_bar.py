#!/usr/bin/env python3
"""
Template: Horizontal Bar Chart (水平条形图)
Usage: Importance ranking, factor comparison sorted by value.
Customize: Edit DATA, CAPTION, OUTPUT_PATH below.

Style: Black-and-white academic, matching SJTU MBA thesis format.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import os

# ============================================================
# CONFIGURATION
# ============================================================

# Data: list of (label, value) tuples — will be displayed bottom-to-top
# so the first item appears at the top of the chart
DATA = [
    ("因素 A", 57),
    ("因素 B", 36),
    ("因素 C", 7),
]

TITLE = ""
XLABEL = "重要性占比 (%)"
YLABEL = ""
SHOW_VALUE_LABELS = True
VALUE_FORMAT = "{:.0f}%"
FIGSIZE = (8, 4.5)
DPI = 300

CAPTION_CN = "图 X-Y    条形图标题"
CAPTION_EN = "Figure X-Y  Horizontal Bar Title"

OUTPUT_PATH = "docs/figures/figX-Y.png"

# ============================================================
# STYLE
# ============================================================

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
})

# ============================================================
# RENDERING
# ============================================================

# Reverse so first item in DATA appears at top
labels = [d[0] for d in reversed(DATA)]
values = [d[1] for d in reversed(DATA)]

# Alternating gray shades for visual distinction
n = len(labels)
colors = ['#404040' if i % 2 == 0 else '#808080' for i in range(n)]

fig, ax = plt.subplots(figsize=FIGSIZE)

bars = ax.barh(labels, values, color=colors, edgecolor='black', linewidth=0.8, height=0.5)

if SHOW_VALUE_LABELS:
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + 0.8, bar.get_y() + bar.get_height() / 2,
                VALUE_FORMAT.format(val),
                ha='left', va='center', fontsize=9)

if TITLE:
    ax.set_title(TITLE, fontsize=13, fontweight='bold', pad=12)
if XLABEL:
    ax.set_xlabel(XLABEL, fontsize=11)

ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.xaxis.grid(True, linestyle='--', alpha=0.3, color='gray')
ax.set_axisbelow(True)

fig.text(0.5, 0.02, CAPTION_CN, ha='center', fontsize=11, fontweight='bold')
fig.text(0.5, -0.02, CAPTION_EN, ha='center', fontsize=10)

plt.tight_layout(rect=[0, 0.06, 1, 1])

os.makedirs(os.path.dirname(OUTPUT_PATH) or '.', exist_ok=True)
plt.savefig(OUTPUT_PATH, dpi=DPI, bbox_inches='tight', facecolor='white')
plt.close()
print(f"Saved: {OUTPUT_PATH}")
