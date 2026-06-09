#!/usr/bin/env python3
"""Generate academic charts for thesis chapters 1 and 3.

图号说明（与 thesis.md 引用、磁盘 png 一致）：
  fig1_1() -> fig1-1.png  中国医药市场全渠道销售规模堆叠柱（2020-2025）
  fig1_2() -> fig1-2.png  中国医药市场规模预测（2024-2029E）
  fig3_1() -> fig3-1.png  国家集采各轮次品种数
  fig3_2() -> fig3-2.png  HCP 互动总量与面对面拜访占比
（图 1-3 论文结构图由 fig1-3.dot 经 Graphviz 渲染，不在本脚本内）
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _style import (apply_style, add_caption,
                    C_PRIMARY, C_SECOND, C_TERTIARY, C_LINE, C_ACCENT,
                    C_TARGET, C_EVENT, GRID,
                    FS_AXIS_LABEL, FS_TICK, FS_DATA_LABEL, FS_LEGEND, FS_ANNOT)
import matplotlib.pyplot as plt
import numpy as np

apply_style()


# ============================================================
# Fig 1-1: China pharma market by channel (2020-2025)
# Data from 中康 2025 report (unit: 十亿 RMB)
# ============================================================
def fig1_1():
    years = ['2020', '2021', '2022', '2023', '2024', '2025']
    hospital = [886, 998, 968, 1072, 1059, 1042]  # 70%,71%,68%,69%,69%,68% of total
    retail = [317, 352, 384, 388, 368, 368]        # 25%,25%,27%,25%,24%,24%
    dtp = [63, 56, 71, 92, 107, 123]               # 4%,4%,5%,6%,7%,8%
    total = [h+r+d for h, r, d in zip(hospital, retail, dtp)]

    fig, ax = plt.subplots(figsize=(8, 5))
    x = np.arange(len(years))
    w = 0.55

    ax.bar(x, hospital, w, label='医院渠道', color=C_PRIMARY)
    ax.bar(x, retail, w, bottom=hospital, label='零售药店', color=C_SECOND)
    ax.bar(x, dtp, w, bottom=[h+r for h, r in zip(hospital, retail)],
           label='DTP药店', color=C_TERTIARY)

    # 柱顶总额标签（下层）与增长率（上层）分层放置，避免重叠
    for i, t in enumerate(total):
        ax.text(i, t + 20, f'{t/100:.1f}万亿', ha='center', va='bottom',
                fontsize=FS_DATA_LABEL)
    growth_labels = ['', '+11%', '+1%', '+9%', '-1%', '0%']
    for i, g in enumerate(growth_labels):
        if g:
            ax.text(i, total[i] + 70, g, ha='center', va='bottom',
                    fontsize=FS_ANNOT,
                    color=C_ACCENT if g.startswith('-') else C_TARGET)

    ax.set_xlabel('年份', fontsize=FS_AXIS_LABEL)
    ax.set_ylabel('销售额（十亿元人民币）', fontsize=FS_AXIS_LABEL)
    ax.set_xticks(x)
    ax.set_xticklabels(years, fontsize=FS_TICK)
    ax.tick_params(axis='y', labelsize=FS_TICK)
    ax.set_ylim(0, 1850)  # 抬高上限给顶部两行标注留白
    ax.legend(loc='upper left', fontsize=FS_LEGEND, frameon=False)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    add_caption(fig, '图 1-1    中国医药市场全渠道销售规模（2020-2025）',
                'Figure 1-1  China Pharmaceutical Market Sales by Channel (2020-2025)')
    plt.tight_layout(rect=[0, 0.06, 1, 1])
    fig.savefig('docs/figures/fig1-1.png')
    plt.close(fig)
    print("Generated fig1-1.png")


# ============================================================
# Fig 1-2: China pharma market forecast (2024-2029)
# Data from IQVIA Market Prognosis (RMB billion)
# ============================================================
def fig1_2():
    years = ['2024', '2025', '2026E', '2027E', '2028E', '2029E']
    total_rmb_bn = [1195.2, 1198.9, 1211.5, 1232.4, 1253.2, 1275.1]
    growth = [1.8, 0.3, 1.0, 1.7, 1.7, 1.8]

    fig, ax1 = plt.subplots(figsize=(8, 5))
    x = np.arange(len(years))
    ax1.bar(x, total_rmb_bn, 0.5, color=C_PRIMARY, label='市场规模')

    ax1.set_xlabel('年份', fontsize=FS_AXIS_LABEL)
    ax1.set_ylabel('市场规模（十亿元人民币）', fontsize=FS_AXIS_LABEL)
    ax1.set_xticks(x)
    ax1.set_xticklabels(years, fontsize=FS_TICK)
    ax1.tick_params(axis='y', labelsize=FS_TICK)
    ax1.set_ylim(1100, 1350)

    for i, v in enumerate(total_rmb_bn):
        ax1.text(i, v + 5, f'{v:.0f}', ha='center', va='bottom',
                 fontsize=FS_DATA_LABEL)

    # 副轴：同比增长率（近黑折线）
    ax2 = ax1.twinx()
    ax2.plot(x, growth, 'o-', color=C_LINE, linewidth=1.8, markersize=6,
             markerfacecolor='white', markeredgewidth=1.8, label='同比增长率')
    ax2.set_ylabel('同比增长率（%）', fontsize=FS_AXIS_LABEL)
    ax2.set_ylim(-0.5, 4.0)
    ax2.tick_params(axis='y', labelsize=FS_TICK)

    for i, g in enumerate(growth):
        ax2.text(i, g + 0.2, f'{g}%', ha='center', va='bottom',
                 fontsize=FS_DATA_LABEL, color=C_LINE)

    ax1.annotate('CAGR 1.3%', xy=(4.5, 1270), fontsize=FS_AXIS_LABEL,
                 fontweight='bold', color=C_ACCENT, ha='center')

    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1+h2, l1+l2, loc='upper left', fontsize=FS_LEGEND, frameon=False)

    ax1.spines['top'].set_visible(False)
    ax2.spines['top'].set_visible(False)

    add_caption(fig, '图 1-2    中国医药市场规模预测（2024-2029E）',
                'Figure 1-2  China Pharmaceutical Market Forecast (2024-2029E)')
    plt.tight_layout(rect=[0, 0.06, 1, 1])
    fig.savefig('docs/figures/fig1-2.png')
    plt.close(fig)
    print("Generated fig1-2.png")


# ============================================================
# Fig 3-1: National VBP rounds and covered products
# ============================================================
def fig3_1():
    rounds = ['第1轮\n2018', '第2轮\n2020', '第3轮\n2020', '第4轮\n2021',
              '第5轮\n2021', '第6轮\n2022', '第7轮\n2022', '第8轮\n2023',
              '第9轮\n2024', '第10轮\n2025', '第11轮\n2025']
    products = [25, 57, 112, 157, 218, 258, 312, 350, 385, 435, 490]
    per_round = [25, 32, 55, 45, 61, 40, 54, 38, 35, 50, 55]

    fig, ax1 = plt.subplots(figsize=(10, 5))
    x = np.arange(len(rounds))
    ax1.bar(x, per_round, 0.6, color=C_PRIMARY, label='本轮新增品种数')

    # 副轴：累计覆盖（近黑折线）
    ax2 = ax1.twinx()
    ax2.plot(x, products, 's-', color=C_LINE, linewidth=1.8, markersize=5,
             markerfacecolor='white', markeredgewidth=1.5, label='累计覆盖品种数')
    ax2.set_ylabel('累计覆盖品种数', fontsize=FS_AXIS_LABEL)
    ax2.tick_params(axis='y', labelsize=FS_TICK)

    for i, p in enumerate(products):
        ax2.text(i, p + 12, str(p), ha='center', va='bottom',
                 fontsize=FS_ANNOT, color=C_LINE)

    ax1.set_xlabel('集采轮次', fontsize=FS_AXIS_LABEL)
    ax1.set_ylabel('本轮新增品种数', fontsize=FS_AXIS_LABEL)
    ax1.set_xticks(x)
    ax1.set_xticklabels(rounds, fontsize=FS_ANNOT)
    ax1.tick_params(axis='y', labelsize=FS_TICK)
    ax1.set_ylim(0, 80)
    ax2.set_ylim(0, 600)

    ax2.axhline(y=600, color=C_TARGET, linestyle='--', linewidth=1, alpha=0.7)
    ax2.text(10.5, 600, '目标600', fontsize=FS_ANNOT, color=C_TARGET,
             va='bottom', ha='right')

    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1+h2, l1+l2, loc='upper left', fontsize=FS_LEGEND, frameon=False)

    ax1.spines['top'].set_visible(False)
    ax2.spines['top'].set_visible(False)

    add_caption(fig, '图 3-1    国家集采各轮次新增与累计覆盖品种数（2018-2025）',
                'Figure 3-1  New and Cumulative Products Covered by National VBP (2018-2025)')
    plt.tight_layout(rect=[0, 0.06, 1, 1])
    fig.savefig('docs/figures/fig3-1.png')
    plt.close(fig)
    print("Generated fig3-1.png")


# ============================================================
# Fig 3-2: HCP interaction decline (anti-corruption impact)
# ============================================================
def fig3_2():
    years = ['2019\n(基准)', '2020', '2021', '2022', '2023', '2024']
    total_interaction = [100, 62, 68, 72, 69, 74]  # overall -26% vs 2019
    face_to_face_pct = [91, 55, 50, 52, 48, 60]    # % of total that is F2F

    fig, ax1 = plt.subplots(figsize=(8, 5))
    x = np.arange(len(years))
    ax1.bar(x, total_interaction, 0.5, color=C_PRIMARY,
            label='HCP互动总量指数（2019=100）')

    for i, v in enumerate(total_interaction):
        ax1.text(i, v + 1.5, str(v), ha='center', va='bottom',
                 fontsize=FS_DATA_LABEL)

    # 副轴：面对面占比（近黑折线）
    ax2 = ax1.twinx()
    ax2.plot(x, face_to_face_pct, 'o-', color=C_LINE, linewidth=1.8, markersize=6,
             markerfacecolor='white', markeredgewidth=1.8, label='面对面拜访占比（%）')
    ax2.set_ylabel('面对面拜访占比（%）', fontsize=FS_AXIS_LABEL)
    ax2.set_ylim(30, 100)
    ax2.tick_params(axis='y', labelsize=FS_TICK)

    for i, p in enumerate(face_to_face_pct):
        ax2.text(i, p + 2, f'{p}%', ha='center', va='bottom',
                 fontsize=FS_ANNOT, color=C_LINE)

    ax1.annotate('COVID-19\n爆发', xy=(1, 62), xytext=(1.5, 85),
                 fontsize=FS_ANNOT, ha='center', color=C_EVENT,
                 arrowprops=dict(arrowstyle='->', color=C_EVENT, lw=1))
    ax1.annotate('反腐运动\n启动', xy=(4, 69), xytext=(3.5, 85),
                 fontsize=FS_ANNOT, ha='center', color=C_EVENT,
                 arrowprops=dict(arrowstyle='->', color=C_EVENT, lw=1))

    ax1.set_xlabel('年份', fontsize=FS_AXIS_LABEL)
    ax1.set_ylabel('互动总量指数', fontsize=FS_AXIS_LABEL)
    ax1.set_xticks(x)
    ax1.set_xticklabels(years, fontsize=FS_TICK)
    ax1.tick_params(axis='y', labelsize=FS_TICK)
    ax1.set_ylim(0, 120)

    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1+h2, l1+l2, loc='upper right', fontsize=FS_LEGEND, frameon=False)

    ax1.spines['top'].set_visible(False)
    ax2.spines['top'].set_visible(False)

    add_caption(fig, '图 3-2    医药行业 HCP 互动总量与面对面拜访占比演变（2019-2024）',
                'Figure 3-2  HCP Interaction Volume and Face-to-Face Visit Share (2019-2024)')
    plt.tight_layout(rect=[0, 0.06, 1, 1])
    fig.savefig('docs/figures/fig3-2.png')
    plt.close(fig)
    print("Generated fig3-2.png")


if __name__ == '__main__':
    fig1_1()
    fig1_2()
    fig3_1()
    fig3_2()
    print("All charts generated successfully.")
