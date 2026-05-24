"""
scripts/compute-sensitivity.py — 汇总 SA 迭代敏感性扫描的 12 次运行
读 data/case/output/sensitivity/bc-{省}-iter{N}/{result,as-is}.json
计算 As-Is CV / To-Be CV / 改善幅度 / 超阈辖区数 / 耗时
输出汇总表 + summary.json
"""

import importlib.util
import json
import sys
from pathlib import Path
from typing import Optional

# 复用 compute-metrics.py 里的函数（路径含连字符无法 import）
spec = importlib.util.spec_from_file_location(
    'compute_metrics', 'scripts/compute-metrics.py')
cm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cm)

ROOT = Path('data/case/output/sensitivity')
ITERS = [100000, 300000, 500000, 1000000]
PROVS = ['上海', '湖南', '新疆']


def collect(prov: str, iter_n: int) -> Optional[dict]:
    out = ROOT / f'bc-{prov}-iter{iter_n}'
    rfile = out / 'result.json'
    afile = out / 'as-is.json'
    if not rfile.exists() or not afile.exists():
        return None
    with open(rfile) as f:
        r = json.load(f)
    with open(afile) as f:
        as_is = json.load(f)

    # To-Be CV
    tobe = cm.compute_index_balance(r['territoryResults'])

    # As-Is reconstruct (取首次出现避免重复累加)
    hi_map: dict = {}
    h_meta: dict = {}
    for tr in r['territoryResults']:
        for h in tr['hospitals']:
            ic = h['inscode']
            if ic not in hi_map:
                hi_map[ic] = h.get('index', 0)
                h_meta[ic] = h
    as_is_trs = cm.compute_as_is_baseline(as_is['historical'], hi_map, h_meta)
    asis = cm.compute_index_balance(as_is_trs)

    improve = (asis['cv'] - tobe['cv']) / asis['cv'] * 100 if asis['cv'] else 0

    return {
        'province': prov,
        'iterations': iter_n,
        'as_is_cv_pct': asis['cv_pct'],
        'to_be_cv_pct': tobe['cv_pct'],
        'cv_improvement_pct': round(improve, 1),
        'out_of_range_count': tobe['out_of_range_count'],
        'out_of_range_pct': tobe['out_of_range_pct'],
        'elapsed_sec': round(r['meta']['elapsedSec'], 2),
    }


def main():
    rows = []
    for prov in PROVS:
        for it in ITERS:
            row = collect(prov, it)
            if row is None:
                print(f'⚠ 缺数据：bc-{prov}-iter{it}', file=sys.stderr)
                continue
            rows.append(row)

    out_path = ROOT / 'summary.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
    print(f'\n→ {out_path}')

    # 控制台表格
    print('\n=== SA 迭代次数敏感性扫描汇总 ===')
    print(f'{"省份":<6} {"迭代次数":>10} {"As-Is CV":>10} {"To-Be CV":>10} '
          f'{"改善":>8} {"超阈":>6} {"耗时":>8}')
    print('-' * 70)
    for r in rows:
        print(f'{r["province"]:<6} {r["iterations"]:>10,d} '
              f'{r["as_is_cv_pct"]:>9.1f}% {r["to_be_cv_pct"]:>9.1f}% '
              f'{r["cv_improvement_pct"]:>+7.1f}% '
              f'{r["out_of_range_count"]:>6d} {r["elapsed_sec"]:>7.2f}s')


if __name__ == '__main__':
    main()
