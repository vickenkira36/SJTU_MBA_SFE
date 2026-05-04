#!/usr/bin/env python3
"""
Template: Pie Chart (饼图/比例图)
Usage: Distribution proportions, composition breakdown.
Customize: Edit DATA, CAPTION, OUTPUT_PATH below.

Style: Black-and-white academic with gray-scale wedges, matching SJTU MBA thesis format.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import os

# ============================================================
# CONFIGURATION
# ============================================================

# Data: list of (label, value) tuples
DATA = [
    ("类别 A", 44.5),
    ("类别 B", 30.2),
    ("类别 C", 15.8),
    ("类别 D", 9.5),
]

TITLE = ""
SHOW_PERCENTAGE = True         # Show % on wedges
SHOW_LEGEND = True             # Show legend box
STARTANGLE = 90                # Start from top
FIGSIZE = (7, 5)
DPI = 300

CAPTION_CN = "图 X-Y    饼图标题"
CAPTION_EN = "Figure X-Y  Pie Chart Title"

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
})

# ============================================================
# RENDERING
# ============================================================

labels = [d[0] for d in DATA]
values = [d[1] for d in DATA]

# Gray-scale colors from dark to light
n = len(labels)
colors = [plt.cm.gray(0.3 + 0.5 * i / max(n - 1, 1)) for i in range(n)]

fig, ax = plt.subplots(figsize=FIGSIZE)

autopct = '%1.1f%%' if SHOW_PERCENTAGE else None
wedges, texts, autotexts = ax.pie(
    values,
    labels=None if SHOW_LEGEND else labels,
    autopct=autopct,
    startangle=STARTANGLE,
    colors=colors,
    wedgeprops={'edgecolor': 'black', 'linewidth': 0.8},
    textprops={'fontsize': 10},
    pctdistance=0.65,
)

if autotexts:
    for t in autotexts:
        t.set_fontsize(9)
        t.set_color('black')

if SHOW_LEGEND:
    ax.legend(wedges, labels, loc='center left', bbox_to_anchor=(1, 0.5),
              fontsize=10, frameon=True, edgecolor='black')

if TITLE:
    ax.set_title(TITLE, fontsize=13, fontweight='bold', pad=12)

fig.text(0.5, 0.02, CAPTION_CN, ha='center', fontsize=11, fontweight='bold')
fig.text(0.5, -0.02, CAPTION_EN, ha='center', fontsize=10)

plt.tight_layout(rect=[0, 0.06, 1, 1])

os.makedirs(os.path.dirname(OUTPUT_PATH) or '.', exist_ok=True)
plt.savefig(OUTPUT_PATH, dpi=DPI, bbox_inches='tight', facecolor='white')
plt.close()
print(f"Saved: {OUTPUT_PATH}")
