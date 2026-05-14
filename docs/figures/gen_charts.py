#!/usr/bin/env python3
"""Generate academic charts for thesis chapters 1 and 3."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np

# --- CJK font detection ---
preferred = ['Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK TC',
             'WenQuanYi Micro Hei', 'SimHei', 'Microsoft YaHei']
available = {f.name for f in fm.fontManager.ttflist}
CJK_FONT = next((f for f in preferred if f in available), None)
if CJK_FONT is None:
    raise RuntimeError(f"No CJK font found. Available: {sorted(available)[:20]}")
print(f"Using font: {CJK_FONT}")

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': [CJK_FONT, 'DejaVu Sans'],
    'axes.unicode_minus': False,
    'figure.dpi': 300,
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
    'figure.facecolor': 'white',
})

# Color palette - academic grayscale + one accent
C_HOSPITAL = '#2c3e50'
C_RETAIL = '#7f8c8d'
C_DTP = '#bdc3c7'
C_ACCENT = '#e74c3c'
C_BLUE = '#2980b9'
C_GREEN = '#27ae60'


# ============================================================
# Fig 1-2: China pharma market by channel (2020-2025)
# Data from 中康 2025 report (unit: 十亿 RMB)
# ============================================================
def fig1_2():
    years = ['2020', '2021', '2022', '2023', '2024', '2025']
    hospital = [886, 998, 968, 1072, 1059, 1042]  # 70%,71%,68%,69%,69%,68% of total
    retail = [317, 352, 384, 388, 368, 368]        # 25%,25%,27%,25%,24%,24%
    dtp = [63, 56, 71, 92, 107, 123]               # 4%,4%,5%,6%,7%,8%
    total = [h+r+d for h,r,d in zip(hospital, retail, dtp)]

    fig, ax = plt.subplots(figsize=(8, 5))
    x = np.arange(len(years))
    w = 0.55

    ax.bar(x, hospital, w, label='医院渠道', color=C_HOSPITAL)
    ax.bar(x, retail, w, bottom=hospital, label='零售药店', color=C_RETAIL)
    ax.bar(x, dtp, w, bottom=[h+r for h,r in zip(hospital, retail)], label='DTP药店', color=C_DTP)

    # Total labels on top
    for i, t in enumerate(total):
        ax.text(i, t + 15, f'{t/100:.1f}万亿', ha='center', va='bottom', fontsize=8)

    # Growth rate annotations
    growth_labels = ['', '+11%', '+1%', '+9%', '-1%', '0%']
    for i, g in enumerate(growth_labels):
        if g:
            ax.text(i, total[i] + 45, g, ha='center', va='bottom', fontsize=7,
                   color=C_ACCENT if g.startswith('-') else C_GREEN)

    ax.set_xlabel('年份', fontsize=10)
    ax.set_ylabel('销售额（十亿元人民币）', fontsize=10)
    ax.set_xticks(x)
    ax.set_xticklabels(years)
    ax.set_ylim(0, 1700)
    ax.legend(loc='upper left', fontsize=9)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    fig.savefig('docs/figures/fig1-2.png')
    plt.close(fig)
    print("Generated fig1-2.png")


# ============================================================
# Fig 1-3: China pharma market forecast (2024-2029)
# Data from IQVIA Market Prognosis (RMB million -> 万亿)
# ============================================================
def fig1_3():
    years = ['2024', '2025', '2026E', '2027E', '2028E', '2029E']
    total_rmb_bn = [1195.2, 1198.9, 1211.5, 1232.4, 1253.2, 1275.1]  # billion RMB
    growth = [1.8, 0.3, 1.0, 1.7, 1.7, 1.8]

    fig, ax1 = plt.subplots(figsize=(8, 5))

    x = np.arange(len(years))
    bars = ax1.bar(x, total_rmb_bn, 0.5, color=C_HOSPITAL, alpha=0.8, label='市场规模')

    ax1.set_xlabel('年份', fontsize=10)
    ax1.set_ylabel('市场规模（十亿元人民币）', fontsize=10)
    ax1.set_xticks(x)
    ax1.set_xticklabels(years)
    ax1.set_ylim(1100, 1350)

    # Add value labels
    for i, v in enumerate(total_rmb_bn):
        ax1.text(i, v + 5, f'{v:.0f}', ha='center', va='bottom', fontsize=8)

    # Growth rate on secondary axis
    ax2 = ax1.twinx()
    ax2.plot(x, growth, 'o-', color=C_ACCENT, linewidth=2, markersize=6, label='同比增长率')
    ax2.set_ylabel('同比增长率（%）', fontsize=10, color=C_ACCENT)
    ax2.set_ylim(-0.5, 4.0)
    ax2.tick_params(axis='y', labelcolor=C_ACCENT)

    for i, g in enumerate(growth):
        ax2.text(i, g + 0.2, f'{g}%', ha='center', va='bottom', fontsize=8, color=C_ACCENT)

    # CAGR annotation
    ax1.annotate('CAGR 1.3%', xy=(4.5, 1270), fontsize=11, fontweight='bold',
                color=C_ACCENT, ha='center')

    # Combine legends
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1+h2, l1+l2, loc='upper left', fontsize=9)

    ax1.spines['top'].set_visible(False)
    ax2.spines['top'].set_visible(False)

    fig.savefig('docs/figures/fig1-3.png')
    plt.close(fig)
    print("Generated fig1-3.png")


# ============================================================
# Fig 3-1: National VBP rounds and covered products
# Data from IQVIA report
# ============================================================
def fig3_1():
    rounds = ['第1轮\n2018', '第2轮\n2020', '第3轮\n2020', '第4轮\n2021',
              '第5轮\n2021', '第6轮\n2022', '第7轮\n2022', '第8轮\n2023',
              '第9轮\n2024', '第10轮\n2025', '第11轮\n2025']
    # Cumulative covered active ingredients
    products = [25, 57, 112, 157, 218, 258, 312, 350, 385, 435, 490]
    # Per-round new products
    per_round = [25, 32, 55, 45, 61, 40, 54, 38, 35, 50, 55]

    fig, ax1 = plt.subplots(figsize=(10, 5))
    x = np.arange(len(rounds))

    bars = ax1.bar(x, per_round, 0.6, color=C_HOSPITAL, alpha=0.8, label='本轮新增品种数')

    # Cumulative line
    ax2 = ax1.twinx()
    ax2.plot(x, products, 's-', color=C_ACCENT, linewidth=2, markersize=5, label='累计覆盖品种数')
    ax2.set_ylabel('累计覆盖品种数', fontsize=10, color=C_ACCENT)
    ax2.tick_params(axis='y', labelcolor=C_ACCENT)

    for i, p in enumerate(products):
        ax2.text(i, p + 12, str(p), ha='center', va='bottom', fontsize=7, color=C_ACCENT)

    ax1.set_xlabel('集采轮次', fontsize=10)
    ax1.set_ylabel('本轮新增品种数', fontsize=10)
    ax1.set_xticks(x)
    ax1.set_xticklabels(rounds, fontsize=7)
    ax1.set_ylim(0, 80)
    ax2.set_ylim(0, 600)

    # Target line at 600
    ax2.axhline(y=600, color=C_GREEN, linestyle='--', linewidth=1, alpha=0.7)
    ax2.text(10.5, 600, '目标600', fontsize=8, color=C_GREEN, va='bottom', ha='right')

    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1+h2, l1+l2, loc='upper left', fontsize=9)

    ax1.spines['top'].set_visible(False)
    ax2.spines['top'].set_visible(False)

    fig.savefig('docs/figures/fig3-1.png')
    plt.close(fig)
    print("Generated fig3-1.png")


# ============================================================
# Fig 3-2: HCP interaction decline (anti-corruption impact)
# Data from IQVIA Sales and Promotion section
# ============================================================
def fig3_2():
    years = ['2019\n(基准)', '2020', '2021', '2022', '2023', '2024']
    # Index: 2019 = 100
    total_interaction = [100, 62, 68, 72, 69, 74]  # overall -26% vs 2019
    face_to_face_pct = [91, 55, 50, 52, 48, 60]    # % of total that is F2F

    fig, ax1 = plt.subplots(figsize=(8, 5))
    x = np.arange(len(years))

    # Bar: total interaction index
    bars = ax1.bar(x, total_interaction, 0.5, color=C_HOSPITAL, alpha=0.8,
                   label='HCP互动总量指数（2019=100）')

    for i, v in enumerate(total_interaction):
        ax1.text(i, v + 1.5, str(v), ha='center', va='bottom', fontsize=9)

    # Line: F2F percentage
    ax2 = ax1.twinx()
    ax2.plot(x, face_to_face_pct, 'o-', color=C_ACCENT, linewidth=2, markersize=6,
             label='面对面拜访占比（%）')
    ax2.set_ylabel('面对面拜访占比（%）', fontsize=10, color=C_ACCENT)
    ax2.set_ylim(30, 100)
    ax2.tick_params(axis='y', labelcolor=C_ACCENT)

    for i, p in enumerate(face_to_face_pct):
        ax2.text(i, p + 2, f'{p}%', ha='center', va='bottom', fontsize=8, color=C_ACCENT)

    # Annotations for key events
    ax1.annotate('COVID-19\n爆发', xy=(1, 62), xytext=(1.5, 85),
                fontsize=8, ha='center', color=C_BLUE,
                arrowprops=dict(arrowstyle='->', color=C_BLUE, lw=1))
    ax1.annotate('反腐运动\n启动', xy=(4, 69), xytext=(3.5, 85),
                fontsize=8, ha='center', color=C_BLUE,
                arrowprops=dict(arrowstyle='->', color=C_BLUE, lw=1))

    ax1.set_xlabel('年份', fontsize=10)
    ax1.set_ylabel('互动总量指数', fontsize=10)
    ax1.set_xticks(x)
    ax1.set_xticklabels(years)
    ax1.set_ylim(0, 120)

    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1+h2, l1+l2, loc='upper right', fontsize=8)

    ax1.spines['top'].set_visible(False)
    ax2.spines['top'].set_visible(False)

    fig.savefig('docs/figures/fig3-2.png')
    plt.close(fig)
    print("Generated fig3-2.png")


if __name__ == '__main__':
    fig1_2()
    fig1_3()
    fig3_1()
    fig3_2()
    print("All charts generated successfully.")
