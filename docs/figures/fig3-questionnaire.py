"""
附录 A 调研结果图（图 3-4 至 图 3-10）
数据来源：作者整理自 SFE 行业从业者深度访谈与问卷调研（N=12），探索性研究用途。
所有图统一字体、配色、DPI；输出到 docs/figures/fig3-X.png。
"""
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np

# === 字体配置：优先简体中文 ===
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

OUT = 'docs/figures'
DPI = 220

# 灰度配色 + 一个强调色
GRAYS = ['#202020', '#505050', '#808080', '#B0B0B0', '#D8D8D8', '#EEEEEE']
EMPHASIS = '#404040'   # 主色（深灰）
LIGHT = '#A8A8A8'      # 次色（浅灰）
HILITE = '#1F4E79'     # 强调色（深蓝），用于标注论文取值


# === 图 3-4 受访者背景分布（5 行水平堆叠条形）===
def fig_34():
    fig, ax = plt.subplots(figsize=(9, 4.8))

    # 5 个维度，每行总数 12
    rows = [
        ('辖区数量经验', ['1-3 个', '4-10 个', '11-30 个', '>30 个'],
         [2, 5, 4, 1]),
        ('产品线', ['处方专科', '处方普药', 'OTC', '多产品线'],
         [5, 4, 1, 2]),
        ('企业类型', ['跨国', '国内大型', '国内中小'],
         [6, 4, 2]),
        ('工作年限', ['<3 年', '3-5 年', '5-10 年', '>10 年'],
         [1, 4, 5, 2]),
        ('角色', ['销售管理者', '一线代表', 'SFE 分析师', '咨询顾问'],
         [3, 4, 3, 2]),
    ]

    y_pos = np.arange(len(rows))
    for i, (label, cats, counts) in enumerate(rows):
        left = 0
        for j, (cat, c) in enumerate(zip(cats, counts)):
            color = GRAYS[j % len(GRAYS)]
            ax.barh(i, c, left=left, color=color, edgecolor='white',
                    linewidth=0.8, height=0.55)
            # 类别标注（白字或黑字根据底色）
            txt_color = 'white' if j < 2 else 'black'
            if c >= 1:
                ax.text(left + c / 2, i, f'{cat}\n{c}',
                        ha='center', va='center', fontsize=9,
                        color=txt_color, linespacing=1.0)
            left += c

    ax.set_yticks(y_pos)
    ax.set_yticklabels([r[0] for r in rows], fontsize=11)
    ax.set_xlabel('受访者人数（合计 N = 12）', fontsize=11)
    ax.set_xlim(0, 12)
    ax.set_xticks(range(0, 13, 2))
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    fig.text(0.5, 0.02, '图 3-4    受访者背景分布', ha='center',
             fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.06, 1, 1])
    plt.savefig(f'{OUT}/fig3-4.png', dpi=DPI, bbox_inches='tight',
                facecolor='white')
    plt.close()
    print('Saved fig3-4.png')


# === 图 3-5 Index 维度入选率与赋权均值双层条形图 ===
def fig_35():
    dims = ['销量', '潜力', 'HCP\n数量', '医院\n市场份额', '医院\n等级',
            '客户\n级别', '地理\n可达性', '产品\n矩阵', '其他']
    sel_rate = [92, 83, 58, 50, 42, 33, 25, 17, 0]    # B1 入选率（%）
    weight_avg = [52, 32, 10, 5, 1, 0, 0, 0, 0]        # B2 被勾选条件下平均权重（%）

    x = np.arange(len(dims))
    width = 0.38

    fig, ax = plt.subplots(figsize=(10, 4.5))

    bars1 = ax.bar(x - width/2, sel_rate, width, color=EMPHASIS,
                   label='B1 维度入选率（%）', edgecolor='white', linewidth=0.6)
    bars2 = ax.bar(x + width/2, weight_avg, width, color=LIGHT,
                   label='B2 被勾选条件下平均权重（%）',
                   edgecolor='white', linewidth=0.6)

    # 数值标注
    for bar, val in zip(bars1, sel_rate):
        if val > 0:
            ax.text(bar.get_x() + bar.get_width()/2, val + 1.5,
                    f'{val}', ha='center', va='bottom', fontsize=9)
    for bar, val in zip(bars2, weight_avg):
        if val > 0:
            ax.text(bar.get_x() + bar.get_width()/2, val + 1.5,
                    f'{val}', ha='center', va='bottom', fontsize=9, color='gray')

    ax.set_xticks(x)
    ax.set_xticklabels(dims, fontsize=10)
    ax.set_ylabel('百分比（%）', fontsize=11)
    ax.set_ylim(0, 105)
    ax.legend(loc='upper right', frameon=False, fontsize=10)
    ax.grid(True, axis='y', linestyle='--', alpha=0.3, color='gray')
    ax.set_axisbelow(True)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    fig.text(0.5, 0.01, '图 3-5    Index 构成维度入选率与赋权均值',
             ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.05, 1, 1])
    plt.savefig(f'{OUT}/fig3-5.png', dpi=DPI, bbox_inches='tight',
                facecolor='white')
    plt.close()
    print('Saved fig3-5.png')


# === 图 3-6 七项核心考量因素重要性雷达图（C1）===
def fig_36():
    factors = ['Index\n均衡性', '地理\n紧凑性', '历史\n延续性',
               '单代表\n工作量', '不跨\n过多城市', '含重点\n大医院',
               '锁定客户\n被尊重']
    means = [4.2, 4.0, 4.5, 4.1, 3.7, 3.8, 4.6]

    angles = np.linspace(0, 2 * np.pi, len(factors), endpoint=False).tolist()
    means_closed = means + [means[0]]
    angles_closed = angles + [angles[0]]

    fig, ax = plt.subplots(figsize=(7, 6.5), subplot_kw=dict(polar=True))

    ax.plot(angles_closed, means_closed, color=EMPHASIS, linewidth=2,
            marker='o', markersize=6, markerfacecolor='white',
            markeredgewidth=1.8)
    ax.fill(angles_closed, means_closed, color=EMPHASIS, alpha=0.15)

    # 数值标注
    for ang, val in zip(angles, means):
        ax.text(ang, val + 0.15, f'{val}', ha='center', va='center',
                fontsize=10, color=EMPHASIS, fontweight='bold')

    ax.set_xticks(angles)
    ax.set_xticklabels(factors, fontsize=10)
    ax.set_ylim(0, 5)
    ax.set_yticks([1, 2, 3, 4, 5])
    ax.set_yticklabels(['1', '2', '3', '4', '5'], fontsize=9, color='gray')
    ax.grid(True, color='gray', alpha=0.3, linestyle='--')
    ax.spines['polar'].set_color('gray')
    ax.spines['polar'].set_linewidth(0.6)

    fig.text(0.5, 0.02, '图 3-6    七项核心考量因素重要性（5 分制均值）',
             ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.05, 1, 1])
    plt.savefig(f'{OUT}/fig3-6.png', dpi=DPI, bbox_inches='tight',
                facecolor='white')
    plt.close()
    print('Saved fig3-6.png')


# === 图 3-7 大医院虚拟拆分阈值频次分布（D1）===
def fig_37():
    options = ['1.2 倍\n以上', '1.5 倍\n以上\n（论文取值）',
               '2 倍\n以上', '不拆分', '视类型\n而定']
    counts = [2, 6, 3, 0, 1]
    pcts = [c / 12 * 100 for c in counts]

    fig, ax = plt.subplots(figsize=(8, 4.5))

    colors = [LIGHT, HILITE, LIGHT, LIGHT, LIGHT]
    bars = ax.bar(options, counts, color=colors, edgecolor='white',
                  linewidth=0.8, width=0.6)

    for bar, c, p in zip(bars, counts, pcts):
        ax.text(bar.get_x() + bar.get_width()/2, c + 0.15,
                f'{c} 人\n({p:.0f}%)', ha='center', va='bottom',
                fontsize=10)

    ax.set_ylabel('受访者人数', fontsize=11)
    ax.set_ylim(0, 8)
    ax.set_yticks(range(0, 9, 2))
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, axis='y', linestyle='--', alpha=0.3, color='gray')
    ax.set_axisbelow(True)

    fig.text(0.5, 0.02, '图 3-7    大医院虚拟拆分阈值频次分布（D1）',
             ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.05, 1, 1])
    plt.savefig(f'{OUT}/fig3-7.png', dpi=DPI, bbox_inches='tight',
                facecolor='white')
    plt.close()
    print('Saved fig3-7.png')


# === 图 3-8 单代表覆盖城市数上限分布（D4）===
def fig_38():
    options = ['1 个\n城市', '2-3 个\n城市', '4-5 个\n城市\n（论文取值）',
               '>5 个\n城市']
    counts = [1, 6, 4, 1]
    pcts = [c / 12 * 100 for c in counts]

    fig, ax = plt.subplots(figsize=(7.5, 4.5))

    colors = [LIGHT, LIGHT, HILITE, LIGHT]
    bars = ax.bar(options, counts, color=colors, edgecolor='white',
                  linewidth=0.8, width=0.55)

    for bar, c, p in zip(bars, counts, pcts):
        ax.text(bar.get_x() + bar.get_width()/2, c + 0.15,
                f'{c} 人\n({p:.0f}%)', ha='center', va='bottom',
                fontsize=10)

    ax.set_ylabel('受访者人数', fontsize=11)
    ax.set_ylim(0, 8)
    ax.set_yticks(range(0, 9, 2))
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, axis='y', linestyle='--', alpha=0.3, color='gray')
    ax.set_axisbelow(True)

    fig.text(0.5, 0.02, '图 3-8    单代表覆盖城市数上限分布（D4）',
             ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.05, 1, 1])
    plt.savefig(f'{OUT}/fig3-8.png', dpi=DPI, bbox_inches='tight',
                facecolor='white')
    plt.close()
    print('Saved fig3-8.png')


# === 图 3-9 单辖区 Index 上下浮动容忍度饼图（D2）===
def fig_39():
    labels = ['±5%\n0 人', '±10%\n2 人 (17%)', '±15%\n6 人 (50%)',
              '±20% 论文取值\n4 人 (33%)', '±30%\n0 人', '视情况\n0 人']
    sizes = [0, 2, 6, 4, 0, 0]
    colors_pie = [GRAYS[5], GRAYS[3], EMPHASIS, HILITE, GRAYS[5], GRAYS[5]]

    # 过滤 0 值
    valid = [(l, s, c) for l, s, c in zip(labels, sizes, colors_pie) if s > 0]
    labels_f = [v[0] for v in valid]
    sizes_f = [v[1] for v in valid]
    colors_f = [v[2] for v in valid]

    fig, ax = plt.subplots(figsize=(7.5, 5.5))
    explode = [0.04 if '论文' in l else 0 for l in labels_f]

    wedges, texts = ax.pie(sizes_f, labels=labels_f, colors=colors_f,
                           startangle=90, counterclock=False,
                           wedgeprops=dict(edgecolor='white', linewidth=2),
                           textprops=dict(fontsize=10),
                           explode=explode)

    ax.axis('equal')

    fig.text(0.5, 0.02, '图 3-9    单辖区 Index 上下浮动容忍度分布（D2）',
             ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.05, 1, 1])
    plt.savefig(f'{OUT}/fig3-9.png', dpi=DPI, bbox_inches='tight',
                facecolor='white')
    plt.close()
    print('Saved fig3-9.png')


# === 图 3-11 G1 三组成对比较结果 ===
def fig_311():
    pairs = [
        ('Index 完美均衡 vs\n客户保留率 92%', 33, 67),
        ('地理跨度大 vs\n紧凑度优先', 42, 58),
        ('算法黑盒 vs\n算法 + 人工调整', 17, 83),
    ]

    labels = [p[0] for p in pairs]
    a_pct = [p[1] for p in pairs]
    b_pct = [p[2] for p in pairs]

    y_pos = np.arange(len(labels))

    fig, ax = plt.subplots(figsize=(9, 4))

    bars_a = ax.barh(y_pos, a_pct, height=0.55, color=LIGHT,
                     edgecolor='white', linewidth=0.8, label='方案 A')
    bars_b = ax.barh(y_pos, b_pct, left=a_pct, height=0.55, color=EMPHASIS,
                     edgecolor='white', linewidth=0.8,
                     label='方案 B（业务侧偏好）')

    # 百分比标注
    for i, (a, b) in enumerate(zip(a_pct, b_pct)):
        ax.text(a / 2, i, f'{a}%', ha='center', va='center',
                fontsize=10, color='black')
        ax.text(a + b / 2, i, f'{b}%', ha='center', va='center',
                fontsize=10, color='white', fontweight='bold')

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=10)
    ax.set_xlim(0, 100)
    ax.set_xlabel('受访者选择比例（%）', fontsize=11)
    ax.set_xticks(range(0, 101, 20))
    ax.legend(loc='lower right', frameon=False, fontsize=10)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    fig.text(0.5, 0.01, '图 3-11    G1 三组成对比较结果',
             ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.05, 1, 1])
    plt.savefig(f'{OUT}/fig3-11.png', dpi=DPI, bbox_inches='tight',
                facecolor='white')
    plt.close()
    print('Saved fig3-11.png')


# === 图 3-10 客户关系差异化保护程度（E1）===
def fig_310():
    relations = ['一线代表与 KOL 客户',
                 '重点大医院（前 10%）',
                 '一对一城市（历史独占）',
                 '同辖区非 KOL 普通客户',
                 '中等 Index 普通医院',
                 '跨多辖区城市内医院']
    means = [4.7, 4.6, 4.5, 3.4, 3.2, 3.0]
    # 前 3 项深色（必须保护层），后 3 项浅色（可调整层）
    colors = [EMPHASIS, EMPHASIS, EMPHASIS, LIGHT, LIGHT, LIGHT]

    y_pos = np.arange(len(relations))[::-1]   # 从上到下：高分在上

    fig, ax = plt.subplots(figsize=(9.5, 4.8))

    bars = ax.barh(y_pos, means, height=0.6, color=colors,
                   edgecolor='white', linewidth=0.8)

    for bar, val in zip(bars, means):
        ax.text(val + 0.05, bar.get_y() + bar.get_height()/2,
                f'{val:.1f}', ha='left', va='center', fontsize=10,
                fontweight='bold')

    ax.set_yticks(y_pos)
    ax.set_yticklabels(relations, fontsize=10)
    ax.set_xlim(0, 5.4)
    ax.set_xlabel('必须保护程度均值（5 分制）', fontsize=11)
    ax.set_xticks([0, 1, 2, 3, 4, 5])

    # 分层参考线（4.5 处）
    ax.axvline(x=4.5, color='gray', linestyle=':', linewidth=1, alpha=0.6)
    ax.text(4.5, len(relations) - 0.3, '4.5 分层线', ha='center',
            va='bottom', fontsize=8, color='gray')

    # 图例
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor=EMPHASIS, label='必须保护层（均值 ≥ 4.5）'),
        Patch(facecolor=LIGHT, label='可调整层（均值 3.0-3.4）'),
    ]
    ax.legend(handles=legend_elements, loc='lower right',
              frameon=False, fontsize=10)

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, axis='x', linestyle='--', alpha=0.3, color='gray')
    ax.set_axisbelow(True)

    fig.text(0.5, 0.01, '图 3-10    客户关系差异化保护程度均值（E1）',
             ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.05, 1, 1])
    plt.savefig(f'{OUT}/fig3-10.png', dpi=DPI, bbox_inches='tight',
                facecolor='white')
    plt.close()
    print('Saved fig3-10.png')


if __name__ == '__main__':
    fig_34()
    fig_35()
    fig_36()
    fig_37()
    fig_38()
    fig_39()
    fig_311()
    fig_310()
    print('\nAll 8 figures generated.')
