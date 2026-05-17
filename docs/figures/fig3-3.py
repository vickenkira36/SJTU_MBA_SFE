"""
图 3-1：A 公司 2020-2025 年销售额与一线销售人员数变化
数据来源：开题答辩 PPT（陈一），已经过开题委员会审议
"""
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

# 优先选简体中文字体，避免 matplotlib 选到日文 fallback 导致中文丢失
PREFERRED = ['Noto Sans CJK SC', 'Hiragino Sans GB', 'PingFang HK', 'Heiti TC', 'STHeiti']
available = {f.name for f in fm.fontManager.ttflist}
FONT_NAME = next((f for f in PREFERRED if f in available), 'sans-serif')

plt.rcParams.update({
    'font.sans-serif': [FONT_NAME] + PREFERRED + ['sans-serif'],
    'font.family': 'sans-serif',
    'font.size': 11,
    'axes.unicode_minus': False,
    'figure.facecolor': 'white',
    'axes.facecolor': 'white',
    'axes.edgecolor': 'black',
    'axes.linewidth': 0.8,
})
print(f'Using font: {FONT_NAME}')

years = ['2020', '2021', '2022', '2023', '2024', '2025']
sales = [11.52, 13.46, 13.87, 14.54, 15.92, 17.31]    # 十亿人民币
people = [2578, 2036, 1893, 2134, 2145, 2383]          # 一线销售人员数

fig, ax1 = plt.subplots(figsize=(8, 4.5))

# 主轴：销售额柱状图（深灰）
bars = ax1.bar(years, sales, color='#404040', width=0.55,
               label='销售额（十亿人民币）', zorder=2)
ax1.set_ylabel('销售额（十亿人民币）', fontsize=11)
ax1.set_xlabel('年份', fontsize=11)
ax1.set_ylim(0, 22)
ax1.spines['top'].set_visible(False)
ax1.tick_params(axis='y', colors='black')
ax1.grid(True, axis='y', linestyle='--', alpha=0.3, color='gray', zorder=0)

# 柱顶销售额标注
for bar, val in zip(bars, sales):
    ax1.text(bar.get_x() + bar.get_width() / 2, val + 0.3, f'{val}',
             ha='center', va='bottom', fontsize=10, color='black')

# 副轴：一线人员折线图（黑色实线）
ax2 = ax1.twinx()
line, = ax2.plot(years, people, color='black', marker='o', linewidth=1.8,
                 markersize=7, markerfacecolor='white', markeredgewidth=1.8,
                 label='一线销售人员数', zorder=3)
ax2.set_ylabel('一线销售人员数（人）', fontsize=11)
ax2.set_ylim(1500, 3000)
ax2.spines['top'].set_visible(False)

# 折线点标注（人数）
for x, y in zip(years, people):
    ax2.text(x, y + 60, f'{y}', ha='center', va='bottom', fontsize=10, color='black')

# 合并图例（柱+线）
handles1, labels1 = ax1.get_legend_handles_labels()
handles2, labels2 = ax2.get_legend_handles_labels()
ax1.legend(handles1 + handles2, labels1 + labels2,
           loc='upper left', frameon=False, fontsize=10)

# 图注
fig.text(0.5, 0.02, "图 3-3    A 公司 2020-2025 年销售额与一线销售人员数变化",
         ha='center', fontsize=11, fontweight='bold')
fig.text(0.5, -0.025, "Figure 3-3  Sales Revenue vs. Frontline Headcount of A Company (2020-2025)",
         ha='center', fontsize=10)

plt.tight_layout(rect=[0, 0.06, 1, 1])
plt.savefig('docs/figures/fig3-3.png', dpi=300, bbox_inches='tight', facecolor='white')
print('Saved docs/figures/fig3-3.png')
