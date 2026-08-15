"""
scripts/aggregate-replicates.py — 汇总 run-replicates.sh 的多次重复运行

主样本：按代价函数（SA 最终 best cost，从 run.log 抓取）选最优的一次，
        输出该次的完整指标供第 5.2/5.3 节使用。
        选优准则用代价函数而非 CV —— 按 CV 挑再拿 CV 论证是循环论证。
扫描：  每格报 均值 ± 标准差，供表 5-3 / 图 5-5 使用。

用法：python3 scripts/aggregate-replicates.py
输出：data/case/output/replicates/summary.json + 控制台报表
"""

import json
import re
import statistics as st
from pathlib import Path

ROOT = Path('data/case/output/replicates')
COST_RE = re.compile(r'最终best=(\d+)')


def load(run_dir: Path):
    log, res, met = run_dir / 'run.log', run_dir / 'result.json', run_dir / 'metrics.json'
    if not (res.exists() and met.exists()):
        return None
    m = COST_RE.search(log.read_text(errors='replace')) if log.exists() else None
    metrics = json.loads(met.read_text())
    tb = metrics['index_balance']['to_be']
    geo = metrics['geographic_compactness']['to_be']
    ret = metrics['retention']
    return {
        'dir': str(run_dir),
        'cost': int(m.group(1)) if m else None,
        'metrics': metrics,
        'cv': tb['cv_pct'],
        'out_of_range': tb['out_of_range_count'],
        'radius': geo['avg_max_radius_km'],
        'cities': geo['avg_city_count'],
        'ret_idx': ret['retention_rate_idx_weighted_pct'],
        'ret_cnt': ret['retention_rate_count_pct'],
    }


def cell(v):
    return f'{st.mean(v):.1f} ± {st.stdev(v):.1f}' if len(v) > 1 else f'{v[0]:.1f}'


def main():
    out = {'main': {}, 'sweep': {}}

    # ---------- 主样本：按 cost 选最优 ----------
    print('=' * 78)
    print('主样本（默认 500K）—— 按代价函数选最优')
    print('=' * 78)
    for prov in ['上海', '湖南', '新疆']:
        runs = [r for r in (load(d) for d in sorted((ROOT / 'main').glob(f'{prov}-r*'))) if r]
        if not runs:
            continue
        priced = [r for r in runs if r['cost'] is not None]
        best = min(priced, key=lambda r: r['cost']) if priced else min(runs, key=lambda r: r['cv'])
        cvs = sorted(r['cv'] for r in runs)
        print(f'\n【{prov}】 n={len(runs)}')
        print(f'  CV 分布      : {"  ".join(f"{c:.1f}" for c in cvs)}')
        print(f'  min/中位/max : {min(cvs):.1f}% / {st.median(cvs):.1f}% / {max(cvs):.1f}%'
              f'   σ={st.stdev(cvs):.2f}' if len(cvs) > 1 else '')
        print(f'  ★ 最优（按 cost={best["cost"]}）')
        print(f'      CV {best["cv"]:.1f}%   超阈 {best["out_of_range"]}   '
              f'半径 {best["radius"]:.1f}km   城市 {best["cities"]:.2f}   '
              f'保留率 Index加权 {best["ret_idx"]:.1f}% / 医院数 {best["ret_cnt"]:.1f}%')
        print(f'      {best["dir"]}')
        # 稳健性：最不利运行
        worst = max(runs, key=lambda r: r['cv'])
        out['main'][prov] = {
            'n': len(runs), 'cv_all': cvs,
            'cv_min': min(cvs), 'cv_median': st.median(cvs), 'cv_max': max(cvs),
            'cv_std': st.stdev(cvs) if len(cvs) > 1 else 0.0,
            'worst_cv': worst['cv'],
            'best_by_cost': {k: best[k] for k in
                             ('dir', 'cost', 'cv', 'out_of_range', 'radius', 'cities', 'ret_idx', 'ret_cnt')},
            'best_metrics': best['metrics'],
        }

    # ---------- 扫描：均值 ± 标准差 ----------
    print('\n' + '=' * 78)
    print('敏感性扫描 —— 每格 均值 ± 标准差（To-Be CV %）')
    print('=' * 78)
    iters = [100000, 300000, 500000, 1000000]
    print(f'\n{"省":<5}' + ''.join(f'{i//1000:>7}K       ' for i in iters))
    for prov in ['上海', '湖南', '新疆']:
        row, cells = {}, []
        for it in iters:
            runs = [r for r in (load(d) for d in sorted((ROOT / 'sweep').glob(f'{prov}-iter{it}-r*'))) if r]
            if not runs:
                cells.append(f'{"-":>14}')
                continue
            v = [r['cv'] for r in runs]
            row[it] = {'n': len(v), 'mean': st.mean(v), 'std': st.stdev(v) if len(v) > 1 else 0.0,
                       'min': min(v), 'max': max(v), 'all': sorted(v)}
            cells.append(f'{cell(v):>14}')
        out['sweep'][prov] = row
        print(f'{prov:<5}' + ''.join(cells))

    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / 'summary.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f'\n→ 输出 {ROOT}/summary.json')


if __name__ == '__main__':
    main()
