#!/usr/bin/env python3
"""Generate fig4-3: SA Move/Swap operation diagram."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# CJK font
import matplotlib.font_manager as fm
preferred = ['Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK TC']
available = {f.name for f in fm.fontManager.ttflist}
CJK_FONT = next((f for f in preferred if f in available), None)
plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': [CJK_FONT, 'DejaVu Sans'],
    'axes.unicode_minus': False,
    'figure.dpi': 300,
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
})

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

# Colors
C_A = '#3498db'
C_B = '#e74c3c'
C_ARROW = '#2c3e50'

# ---- Left panel: Move operation ----
ax1.set_title('(a) Move操作', fontsize=13, fontweight='bold', pad=15)
ax1.set_xlim(0, 10)
ax1.set_ylim(0, 8)
ax1.set_aspect('equal')
ax1.axis('off')

# Territory A (left)
circle_a1 = plt.Circle((2.5, 5), 2.2, fill=True, facecolor=C_A, alpha=0.15, edgecolor=C_A, linewidth=2)
ax1.add_patch(circle_a1)
ax1.text(2.5, 7.5, '辖区 A', ha='center', fontsize=11, color=C_A, fontweight='bold')

# Territory B (right)
circle_b1 = plt.Circle((7.5, 5), 2.2, fill=True, facecolor=C_B, alpha=0.15, edgecolor=C_B, linewidth=2)
ax1.add_patch(circle_b1)
ax1.text(7.5, 7.5, '辖区 B', ha='center', fontsize=11, color=C_B, fontweight='bold')

# Hospitals in A
for x, y, label in [(1.5, 5.5, 'h1'), (2.0, 4.0, 'h2'), (3.5, 5.0, 'h3'), (3.0, 3.5, 'h4')]:
    ax1.plot(x, y, 'o', color=C_A, markersize=10)
    ax1.text(x+0.2, y+0.2, label, fontsize=8, color=C_A)

# The hospital being moved (h3 at border)
ax1.plot(3.5, 5.0, 'o', color=C_A, markersize=12, markeredgecolor='black', markeredgewidth=2)

# Hospitals in B
for x, y, label in [(6.5, 5.5, 'h5'), (7.5, 4.0, 'h6'), (8.5, 5.5, 'h7')]:
    ax1.plot(x, y, 'o', color=C_B, markersize=10)
    ax1.text(x+0.2, y+0.2, label, fontsize=8, color=C_B)

# Arrow: h3 moves from A to B
ax1.annotate('', xy=(6.0, 5.0), xytext=(4.0, 5.0),
            arrowprops=dict(arrowstyle='->', color=C_ARROW, lw=2.5))
ax1.text(5.0, 5.5, 'Move', ha='center', fontsize=11, fontweight='bold', color=C_ARROW)
ax1.text(5.0, 4.3, 'h3: A → B', ha='center', fontsize=9, color=C_ARROW)

# Probability label
ax1.text(5.0, 1.5, '概率: 60%', ha='center', fontsize=10, 
         bbox=dict(boxstyle='round,pad=0.3', facecolor='#fef9e7', edgecolor='#f39c12'))

# ---- Right panel: Swap operation ----
ax2.set_title('(b) Swap操作', fontsize=13, fontweight='bold', pad=15)
ax2.set_xlim(0, 10)
ax2.set_ylim(0, 8)
ax2.set_aspect('equal')
ax2.axis('off')

# Territory A
circle_a2 = plt.Circle((2.5, 5), 2.2, fill=True, facecolor=C_A, alpha=0.15, edgecolor=C_A, linewidth=2)
ax2.add_patch(circle_a2)
ax2.text(2.5, 7.5, '辖区 A', ha='center', fontsize=11, color=C_A, fontweight='bold')

# Territory B
circle_b2 = plt.Circle((7.5, 5), 2.2, fill=True, facecolor=C_B, alpha=0.15, edgecolor=C_B, linewidth=2)
ax2.add_patch(circle_b2)
ax2.text(7.5, 7.5, '辖区 B', ha='center', fontsize=11, color=C_B, fontweight='bold')

# Hospitals in A
for x, y, label in [(1.5, 5.5, 'h1'), (2.0, 4.0, 'h2'), (3.5, 5.5, 'h3'), (3.0, 3.5, 'h4')]:
    ax2.plot(x, y, 'o', color=C_A, markersize=10)
    ax2.text(x+0.2, y+0.2, label, fontsize=8, color=C_A)

# Hospitals in B
for x, y, label in [(6.5, 5.5, 'h5'), (7.5, 4.0, 'h6'), (8.5, 5.5, 'h7')]:
    ax2.plot(x, y, 'o', color=C_B, markersize=10)
    ax2.text(x+0.2, y+0.2, label, fontsize=8, color=C_B)

# Highlight swap candidates
ax2.plot(3.5, 5.5, 'o', color=C_A, markersize=12, markeredgecolor='black', markeredgewidth=2)
ax2.plot(6.5, 5.5, 'o', color=C_B, markersize=12, markeredgecolor='black', markeredgewidth=2)

# Bidirectional arrows
ax2.annotate('', xy=(6.0, 5.9), xytext=(4.0, 5.9),
            arrowprops=dict(arrowstyle='->', color=C_A, lw=2))
ax2.annotate('', xy=(4.0, 5.1), xytext=(6.0, 5.1),
            arrowprops=dict(arrowstyle='->', color=C_B, lw=2))
ax2.text(5.0, 6.4, 'Swap', ha='center', fontsize=11, fontweight='bold', color=C_ARROW)
ax2.text(5.0, 4.3, 'h3 ⇄ h5', ha='center', fontsize=9, color=C_ARROW)

# Probability label
ax2.text(5.0, 1.5, '概率: 40%', ha='center', fontsize=10,
         bbox=dict(boxstyle='round,pad=0.3', facecolor='#fef9e7', edgecolor='#f39c12'))

plt.tight_layout()
fig.savefig('docs/figures/fig4-3.png')
plt.close(fig)
print("Generated fig4-3.png")
