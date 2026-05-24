"""
第五章图表生成脚本（图 5-1 至 图 5-6）
数据来源：data/case/output/{bc-上海, bc-湖北, lc-云南}/{result, metrics}.json
所有图统一字体 Noto Sans CJK SC + 物理宽度约 15 cm + DPI 自适应。
"""
import json
import math
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np

# === 字体配置 ===
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
DATA = 'data/case/output'

# 配色
DARK = '#404040'
LIGHT = '#A8A8A8'
BLUE = '#1F4E79'
RED = '#C0392B'
GREEN = '#27AE60'
GRAY_BG = '#EEEEEE'


def load_data(path_key):
    """加载 result/as-is/metrics 三个 json"""
    base = Path(f'{DATA}/{path_key}')
    with open(base / 'result.json') as f:
        result = json.load(f)
    with open(base / 'as-is.json') as f:
        as_is = json.load(f)
    with open(base / 'metrics.json') as f:
        metrics = json.load(f)
    return result, as_is, metrics


def fig_5_1():
    """图 5-1 湖北 BC Index 均衡度蝴蝶图：As-Is vs To-Be"""
    result, as_is, metrics = load_data('bc-湖南')

    # As-Is：从 historical 重组每辖区 Index 总和
    # 注意：tr.hospitals[i].index 是医院的"全 idx"，同 inscode 跨多 territory 不应累加；
    # 同时 historical portion 总和按 inscode 归一化，确保 As-Is 与 To-Be 在同一总量下对比
    hosp_idx = {}
    for tr in result['territoryResults']:
        for h in tr['hospitals']:
            ic = h['inscode']
            if ic not in hosp_idx:
                hosp_idx[ic] = h['index']

    portion_sum = {}
    for ha in as_is['historical']:
        portion_sum[ha['inscode']] = portion_sum.get(ha['inscode'], 0) + ha.get('portion', 1)

    asis_by_trty = {}
    for ha in as_is['historical']:
        ic = ha['inscode']
        if ic not in hosp_idx:
            continue
        denom = portion_sum.get(ic, 1)
        norm_p = ha.get('portion', 1) / denom if denom else 0
        asis_by_trty[ha['trtyCode']] = asis_by_trty.get(ha['trtyCode'], 0) + hosp_idx[ic] * norm_p

    tobe_by_trty = {tr['trtyCode']: tr['totalIndex'] for tr in result['territoryResults']}

    # 取共有的 trtyCode
    common = sorted(set(asis_by_trty) & set(tobe_by_trty), key=lambda t: -tobe_by_trty[t])
    if len(common) > 16:
        common = common[:16]

    asis_vals = [asis_by_trty[t] for t in common]
    tobe_vals = [tobe_by_trty[t] for t in common]

    fig, ax = plt.subplots(figsize=(9, 5.2))
    y = np.arange(len(common))
    h = 0.38
    # As-Is（左侧负值）
    bars_a = ax.barh(y - h/2, [-v for v in asis_vals], h, color=LIGHT, edgecolor='white', linewidth=0.5, label='As-Is（人工分配）')
    # To-Be（右侧正值）
    bars_b = ax.barh(y + h/2, tobe_vals, h, color=DARK, edgecolor='white', linewidth=0.5, label='To-Be（算法优化）')

    # ±20% 阈值线（理想 1000，± 200）
    ax.axvline(800, color=RED, linestyle='--', linewidth=0.8, alpha=0.5)
    ax.axvline(1200, color=RED, linestyle='--', linewidth=0.8, alpha=0.5)
    ax.axvline(-800, color=RED, linestyle='--', linewidth=0.8, alpha=0.5)
    ax.axvline(-1200, color=RED, linestyle='--', linewidth=0.8, alpha=0.5)
    ax.axvline(0, color='black', linewidth=1)

    # 数值标注
    for i, (a, b) in enumerate(zip(asis_vals, tobe_vals)):
        ax.text(-a - 50, y[i] - h/2, f'{int(a)}', va='center', ha='right', fontsize=8.5, color='black')
        ax.text(b + 50, y[i] + h/2, f'{int(b)}', va='center', ha='left', fontsize=8.5, color='black')

    # 轴
    ax.set_yticks(y)
    ax.set_yticklabels(common, fontsize=9)
    ax.invert_yaxis()
    max_v = max(max(asis_vals), max(tobe_vals)) * 1.15
    ax.set_xlim(-max_v, max_v)
    # 自定义 x 轴显示绝对值
    xticks = ax.get_xticks()
    ax.set_xticklabels([f'{abs(int(t))}' for t in xticks])
    ax.set_xlabel('辖区 Index 总和', fontsize=11)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    # 双向标签
    ax.text(-max_v * 0.85, -0.7, '← As-Is（人工分配）', fontsize=10, color=LIGHT, fontweight='bold')
    ax.text(max_v * 0.45, -0.7, 'To-Be（算法优化）→', fontsize=10, color=DARK, fontweight='bold')
    # 图例：±20% 阈值
    ax.text(max_v * 0.6, len(common) - 0.5, '红虚线：±20% 阈值（800/1200）', fontsize=8.5, color=RED)

    fig.text(0.5, 0.01, '图 5-1    湖南 BC 主样本：As-Is 与 To-Be 辖区 Index 均衡度对比', ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.04, 1, 1])
    plt.savefig(f'{OUT}/fig5-1.png', dpi=200, bbox_inches='tight', facecolor='white')
    plt.close()
    print('Saved fig5-1.png')


def fig_5_2():
    """图 5-2 湖北 BC 地理紧凑性散点图"""
    result, as_is, metrics = load_data('bc-湖南')

    # 计算每辖区的最大半径（As-Is 与 To-Be）
    # As-Is：从 historical 重组
    hosp_meta = {}
    for tr in result['territoryResults']:
        for h in tr['hospitals']:
            hosp_meta[h['inscode']] = h

    def radius(hosps):
        if len(hosps) < 2:
            return 0
        valid = [h for h in hosps if h.get('latitude') and h.get('longitude')]
        if len(valid) < 1:
            return 0
        lat0 = sum(h['latitude'] for h in valid) / len(valid)
        lon0 = sum(h['longitude'] for h in valid) / len(valid)
        R = 6371
        max_d = 0
        for h in valid:
            dlat = math.radians(h['latitude'] - lat0)
            dlon = math.radians(h['longitude'] - lon0)
            a = math.sin(dlat/2)**2 + math.cos(math.radians(lat0))*math.cos(math.radians(h['latitude']))*math.sin(dlon/2)**2
            d = 2 * math.asin(math.sqrt(a)) * R
            max_d = max(max_d, d)
        return max_d

    # As-Is：按 trtyCode 分组
    asis_groups = {}
    for ha in as_is['historical']:
        if ha['inscode'] in hosp_meta:
            asis_groups.setdefault(ha['trtyCode'], []).append(hosp_meta[ha['inscode']])

    asis_radii = {t: radius(hs) for t, hs in asis_groups.items()}
    tobe_radii = {tr['trtyCode']: radius(tr['hospitals']) for tr in result['territoryResults']}

    common = sorted(set(asis_radii) & set(tobe_radii))
    asis_vals = [asis_radii[t] for t in common]
    tobe_vals = [tobe_radii[t] for t in common]

    fig, ax = plt.subplots(figsize=(7.2, 6))
    # 散点
    ax.scatter(asis_vals, tobe_vals, s=70, color=DARK, edgecolor='white', linewidth=1, zorder=3, alpha=0.9)
    # 对角线 y=x
    max_r = max(max(asis_vals), max(tobe_vals)) * 1.1
    ax.plot([0, max_r], [0, max_r], color=LIGHT, linestyle='--', linewidth=1, label='y = x（无变化）')
    # 着色区域：y < x（改善）
    ax.fill_between([0, max_r], 0, [0, max_r], color=GREEN, alpha=0.06, label='改善区域（半径下降）')

    ax.set_xlim(0, max_r)
    ax.set_ylim(0, max_r)
    ax.set_xlabel('As-Is 辖区最大半径（km）', fontsize=11)
    ax.set_ylabel('To-Be 辖区最大半径（km）', fontsize=11)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, linestyle=':', alpha=0.3)
    ax.legend(loc='upper left', frameon=False, fontsize=9.5)

    # 标注均值
    mean_a = sum(asis_vals) / len(asis_vals)
    mean_b = sum(tobe_vals) / len(tobe_vals)
    ax.annotate(f'均值\nAs-Is: {mean_a:.1f} km\nTo-Be: {mean_b:.1f} km\n改善: {(mean_a-mean_b)/mean_a*100:.1f}%',
                xy=(max_r*0.6, max_r*0.05), fontsize=9.5,
                bbox=dict(boxstyle='round,pad=0.4', facecolor=GRAY_BG, edgecolor='gray', linewidth=0.5))

    fig.text(0.5, 0.01, '图 5-2    湖南 BC：辖区最大半径 As-Is vs To-Be 散点图', ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.04, 1, 1])
    plt.savefig(f'{OUT}/fig5-2.png', dpi=200, bbox_inches='tight', facecolor='white')
    plt.close()
    print('Saved fig5-2.png')


def fig_5_3():
    """图 5-3 湖北 BC 客户保留率与震荡成本"""
    _, _, metrics = load_data('bc-湖南')
    ret = metrics['retention']

    # 三组对比：医院数保留率 / Index 加权保留率 / 震荡成本估算
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.5))

    # 子图 1：保留率（按医院数 vs 按 Index 加权）
    ax = axes[0]
    cats = ['完全保留', '部分保留', '完全变动']
    vals = [ret['fully_retained'], ret['partial_retained'], ret['fully_changed']]
    colors = [GREEN, '#F39C12', RED]
    bars = ax.bar(cats, vals, color=colors, edgecolor='white', linewidth=1, width=0.55)
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, v + 1.5, f'{v}', ha='center', va='bottom', fontsize=10, fontweight='bold')
    ax.set_ylabel('医院数', fontsize=11)
    ax.set_title('客户关系变动分布', fontsize=11, pad=8)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, axis='y', linestyle=':', alpha=0.3)
    ax.set_axisbelow(True)
    # 标注总计
    ax.text(2.4, max(vals) * 0.85, f'共 {ret["total_compared_hospitals"]} 家\n医院', ha='center', va='top',
            fontsize=9.5, color='gray', bbox=dict(boxstyle='round,pad=0.3', facecolor=GRAY_BG, edgecolor='none'))

    # 子图 2：保留率对比（医院数 vs Index 加权）
    ax = axes[1]
    metrics_cats = ['按医院数', '按 Index\n加权']
    metric_vals = [ret['retention_rate_count_pct'], ret['retention_rate_idx_weighted_pct']]
    bars = ax.bar(metrics_cats, metric_vals, color=[LIGHT, BLUE], edgecolor='white', linewidth=1, width=0.5)
    for bar, v in zip(bars, metric_vals):
        ax.text(bar.get_x() + bar.get_width()/2, v + 1.5, f'{v}%', ha='center', va='bottom', fontsize=11, fontweight='bold')
    # 业务可接受线 85%
    ax.axhline(85, color=RED, linestyle='--', linewidth=1, alpha=0.6)
    ax.text(1.4, 86, '业务可接受线 85%\n(3.3.3 节 D2 调研)', fontsize=8.5, color=RED, ha='right')
    ax.set_ylabel('保留率 (%)', fontsize=11)
    ax.set_ylim(0, 100)
    ax.set_title('保留率：两种计算口径对比', fontsize=11, pad=8)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, axis='y', linestyle=':', alpha=0.3)
    ax.set_axisbelow(True)

    fig.text(0.5, 0.01, '图 5-3    湖南 BC 主样本：客户保留率与震荡分布', ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.04, 1, 1])
    plt.savefig(f'{OUT}/fig5-3.png', dpi=200, bbox_inches='tight', facecolor='white')
    plt.close()
    print('Saved fig5-3.png')


def _province_map(province_key, fig_num, title):
    """通用：辖区地图（医院点位 + 颜色编码辖区归属）"""
    result, as_is, metrics = load_data(province_key)

    # 收集医院的位置 + As-Is/To-Be 辖区
    hosp_meta = {}
    for tr in result['territoryResults']:
        for h in tr['hospitals']:
            ic = h['inscode']
            if ic not in hosp_meta:
                hosp_meta[ic] = {'lat': h['latitude'], 'lon': h['longitude']}

    asis_assign = {}
    for ha in as_is['historical']:
        if ha['inscode'] in hosp_meta:
            # 单医院多个辖区时，取第一个
            asis_assign.setdefault(ha['inscode'], ha['trtyCode'])

    tobe_assign = {}
    for tr in result['territoryResults']:
        for h in tr['hospitals']:
            tobe_assign.setdefault(h['inscode'], tr['trtyCode'])

    fig, axes = plt.subplots(1, 2, figsize=(11, 5.5))

    # 一致地给 trtyCode 染色（用 tab20 或循环色）
    all_trty = sorted(set(asis_assign.values()) | set(tobe_assign.values()))
    cmap = plt.cm.tab20
    color_map = {t: cmap(i % 20) for i, t in enumerate(all_trty)}

    for ax, assign, sub in zip(axes, [asis_assign, tobe_assign], ['As-Is（人工分配）', 'To-Be（算法优化）']):
        for ic, t in assign.items():
            if ic not in hosp_meta:
                continue
            m = hosp_meta[ic]
            if not m['lat'] or not m['lon']:
                continue
            ax.scatter(m['lon'], m['lat'], s=22, color=color_map[t], edgecolor='white', linewidth=0.4, alpha=0.85)
        ax.set_xlabel('经度', fontsize=10)
        ax.set_ylabel('纬度', fontsize=10)
        ax.set_title(sub, fontsize=11, pad=6)
        ax.set_aspect('equal', adjustable='datalim')
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.grid(True, linestyle=':', alpha=0.3)

    # 添加规模注解
    n_h = result['meta']['hospitalsCount']
    n_t = result['meta']['territoriesCount']
    fig.text(0.5, 0.92, f'{title}（{n_h} 家医院 / {n_t} 个辖区，颜色按辖区归属编码）',
             ha='center', fontsize=10, color='gray')

    fig.text(0.5, 0.02, f'图 5-{fig_num}    {title}：辖区分布 As-Is vs To-Be',
             ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.05, 1, 0.92])
    plt.savefig(f'{OUT}/fig5-{fig_num}.png', dpi=200, bbox_inches='tight', facecolor='white')
    plt.close()
    print(f'Saved fig5-{fig_num}.png')


def fig_5_4():
    _province_map('bc-上海', 4, '上海（聚集型直辖市）')


def fig_5_5():
    _province_map('bc-新疆维吾尔自治区', 5, '新疆（地理跨度极大的稀疏场景）')


def fig_5_6():
    """图 5-6 三省份计算时间与规模"""
    rows = []
    for tag, label in [('bc-上海', '上海 BC'), ('bc-湖南', '湖南 BC'), ('bc-新疆维吾尔自治区', '新疆 BC')]:
        with open(f'{DATA}/{tag}/result.json') as f:
            r = json.load(f)
        rows.append({
            'label': label,
            'N': r['meta']['hospitalsCount'],
            'K': r['meta']['territoriesCount'],
            'NK': r['meta']['hospitalsCount'] * r['meta']['territoriesCount'],
            't': r['meta']['elapsedSec'],
        })

    fig, axes = plt.subplots(1, 2, figsize=(10.5, 4.5))

    # 子图 1：耗时柱状
    ax = axes[0]
    x = np.arange(len(rows))
    bars = ax.bar(x, [r['t'] for r in rows], color=DARK, edgecolor='white', linewidth=1, width=0.55)
    for bar, r in zip(bars, rows):
        ax.text(bar.get_x() + bar.get_width()/2, r['t'] + 0.15, f'{r["t"]:.1f}s', ha='center', va='bottom', fontsize=10)
    ax.set_xticks(x)
    ax.set_xticklabels([r['label'] for r in rows], fontsize=10)
    ax.set_ylabel('计算耗时（秒）', fontsize=11)
    ax.set_title('三省份算法计算耗时', fontsize=11, pad=6)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, axis='y', linestyle=':', alpha=0.3)
    ax.set_axisbelow(True)
    # 参考线：人工方案 4-8 周
    ax.text(2.6, max(r['t'] for r in rows) * 0.9, '对比：人工\n方案 4-8 周', ha='center', fontsize=9, color='gray',
            bbox=dict(boxstyle='round,pad=0.3', facecolor=GRAY_BG, edgecolor='none'))

    # 子图 2：规模 vs 耗时（散点+趋势）
    ax = axes[1]
    nks = [r['NK'] for r in rows]
    ts = [r['t'] for r in rows]
    ax.scatter(nks, ts, s=120, color=DARK, edgecolor='white', linewidth=1.5, zorder=3)
    for r in rows:
        ax.annotate(r['label'], (r['NK'], r['t']), xytext=(8, 8), textcoords='offset points',
                    fontsize=9.5, color='black')
    ax.set_xlabel('问题规模 N×K（医院数 × 辖区数）', fontsize=11)
    ax.set_ylabel('计算耗时（秒）', fontsize=11)
    ax.set_title('规模 vs 耗时', fontsize=11, pad=6)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, linestyle=':', alpha=0.3)
    ax.set_axisbelow(True)

    fig.text(0.5, 0.01, '图 5-6    三省份计算效率与可扩展性', ha='center', fontsize=11, fontweight='bold')
    plt.tight_layout(rect=[0, 0.04, 1, 1])
    plt.savefig(f'{OUT}/fig5-6.png', dpi=200, bbox_inches='tight', facecolor='white')
    plt.close()
    print('Saved fig5-6.png')


if __name__ == '__main__':
    fig_5_1()
    fig_5_2()
    fig_5_3()
    fig_5_4()
    fig_5_5()
    fig_5_6()
    print('\nAll 6 figures generated.')
