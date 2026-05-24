"""
scripts/compute-metrics.py — 第五章实证分析：As-Is vs To-Be 指标对比

读取 run-experiment.ts 输出的 result.json + as-is.json，计算：
  - Index 均衡度：mean / std / CV / 最大偏差比 / 超出 ±20% 阈值的辖区数
  - 地理紧凑性：辖区内最大半径、平均半径、跨城市数
  - 容量均衡：辖区医院数 mean / std
  - 客户保留率：As-Is 与 To-Be 之间相同 (inscode, trtyCode) 的占比（按 Index 加权）

用法：
  python3 scripts/compute-metrics.py data/case/output/bc-上海/result.json
"""

import json
import math
import sys
from collections import defaultdict
from pathlib import Path


def haversine_km(lon1, lat1, lon2, lat2):
    R = 6371
    if any(v is None or v == 0 for v in [lon1, lat1, lon2, lat2]):
        return 0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return 2 * math.asin(math.sqrt(a)) * R


def compute_index_balance(territory_results):
    """Index 均衡度指标"""
    indexes = [tr['totalIndex'] for tr in territory_results]
    n = len(indexes)
    if n == 0:
        return {}
    mean = sum(indexes) / n
    var = sum((x - mean) ** 2 for x in indexes) / n
    std = math.sqrt(var)
    cv = std / mean if mean else 0
    # 理想值 1000；偏差超 ±20%（即 800-1200 范围外）的辖区数
    out_of_range = sum(1 for x in indexes if x < 800 or x > 1200)
    max_dev = max(abs(x - mean) for x in indexes) / mean if mean else 0
    return {
        'count': n,
        'mean': round(mean, 1),
        'std': round(std, 1),
        'cv': round(cv, 4),
        'cv_pct': round(cv * 100, 1),
        'max_dev_ratio': round(max_dev, 4),
        'out_of_range_count': out_of_range,
        'out_of_range_pct': round(out_of_range / n * 100, 1) if n else 0,
        'min': round(min(indexes), 1),
        'max': round(max(indexes), 1),
    }


def compute_geographic_compactness(territory_results):
    """地理紧凑性指标：辖区内最远点到质心的距离"""
    radii = []
    city_counts = []
    for tr in territory_results:
        hospitals = tr['hospitals']
        if not hospitals:
            continue
        # 质心
        valid = [h for h in hospitals if h.get('latitude') and h.get('longitude')]
        if len(valid) < 1:
            continue
        cent_lat = sum(h['latitude'] for h in valid) / len(valid)
        cent_lon = sum(h['longitude'] for h in valid) / len(valid)
        # 最远距离
        max_r = max(haversine_km(cent_lon, cent_lat, h['longitude'], h['latitude']) for h in valid)
        radii.append(max_r)
        # 城市数
        cities = set(h.get('city') for h in hospitals if h.get('city'))
        city_counts.append(len(cities))
    return {
        'avg_max_radius_km': round(sum(radii) / len(radii), 1) if radii else 0,
        'max_max_radius_km': round(max(radii), 1) if radii else 0,
        'avg_city_count': round(sum(city_counts) / len(city_counts), 2) if city_counts else 0,
        'max_city_count': max(city_counts) if city_counts else 0,
        'territories_over_5_cities': sum(1 for c in city_counts if c > 5),
    }


def compute_capacity_balance(territory_results):
    """容量均衡：辖区医院数的分布"""
    counts = [tr['hospitalCount'] for tr in territory_results]
    n = len(counts)
    if n == 0:
        return {}
    mean = sum(counts) / n
    var = sum((c - mean) ** 2 for c in counts) / n
    return {
        'mean_hospitals_per_territory': round(mean, 1),
        'std': round(math.sqrt(var), 1),
        'min': min(counts),
        'max': max(counts),
    }


def compute_retention(historical, to_be_assignments, hospital_index_map):
    """客户保留率：As-Is（historical）vs To-Be（assignments）的 (inscode, trtyCode) 重合度"""
    # As-Is: inscode -> set of trtyCode（按 portion 权重）
    as_is = defaultdict(set)
    as_is_portion = defaultdict(dict)  # inscode -> {trtyCode: portion}
    for ha in historical:
        as_is[ha['inscode']].add(ha['trtyCode'])
        as_is_portion[ha['inscode']][ha['trtyCode']] = ha.get('portion', 1)
    # To-Be: hospitalId 包含 inscode；assignments 用 hospitalId 关联
    # assignments 字段：hospitalId, hospitalName, territoryId, territoryName, splitRatio
    # territoryId 是内部 id (T_idx_TRTY_CODE)；territoryName 是 TRTY_CODE
    to_be = defaultdict(set)
    to_be_portion = defaultdict(dict)
    for a in to_be_assignments:
        # hospitalId 形如 H_0_FJXM343_0（最后的 _0 是拆分序号）
        h_id = a['hospitalId']
        # 提取 inscode：去掉 H_idx_ 前缀和可能的 _split 后缀
        parts = h_id.split('_', 2)  # ['H', idx, rest]
        if len(parts) >= 3:
            rest = parts[2]
            # rest 形如 'FJXM343' 或 'FJXM343_split0'
            inscode = rest.split('_')[0]
        else:
            inscode = h_id
        # territoryName 应该就是 trtyCode
        trty_code = a.get('territoryName', '')
        to_be[inscode].add(trty_code)
        split_ratio = a.get('splitRatio', 1) or 1
        if trty_code in to_be_portion[inscode]:
            to_be_portion[inscode][trty_code] += split_ratio
        else:
            to_be_portion[inscode][trty_code] = split_ratio

    # 计算保留率（按 Index 加权）
    total_idx = 0
    retained_idx = 0
    fully_retained_count = 0
    partial_retained_count = 0
    fully_changed_count = 0
    total_count = 0

    all_inscodes = set(as_is.keys()) | set(to_be.keys())
    for ic in all_inscodes:
        if ic not in as_is or ic not in to_be:
            continue  # 只看在 As-Is 与 To-Be 都有的医院
        idx = hospital_index_map.get(ic, 0)
        total_idx += idx
        total_count += 1
        common = as_is[ic] & to_be[ic]
        if common == as_is[ic] and as_is[ic] == to_be[ic]:
            fully_retained_count += 1
            retained_idx += idx
        elif common:
            # 部分保留：按重合 trtyCode 在 As-Is 中的 portion 加权
            partial = sum(as_is_portion[ic].get(t, 0) for t in common)
            denom = sum(as_is_portion[ic].values())
            ratio = partial / denom if denom else 0
            partial_retained_count += 1
            retained_idx += idx * ratio
        else:
            fully_changed_count += 1

    retention_rate_idx_weighted = retained_idx / total_idx if total_idx else 0
    retention_rate_count = (fully_retained_count + 0.5 * partial_retained_count) / total_count if total_count else 0

    return {
        'total_compared_hospitals': total_count,
        'fully_retained': fully_retained_count,
        'partial_retained': partial_retained_count,
        'fully_changed': fully_changed_count,
        'retention_rate_count_pct': round(retention_rate_count * 100, 1),
        'retention_rate_idx_weighted_pct': round(retention_rate_idx_weighted * 100, 1),
    }


def compute_as_is_baseline(historical, hospital_index_map, hospital_meta):
    """根据 historical 把 As-Is 重新组装成 territory_results，便于复用 Index/紧凑度计算

    注意：historical 中可能存在"重叠覆盖"（同一家医院被多个代表完整覆盖，portion 总和 > 1）。
    为保持 As-Is 与 To-Be 在同一"理论工作量"基础上对比，按 inscode 内 portion 归一化，
    确保每家医院的 idx 贡献总和恰好 = 全 idx（与 To-Be 一致）。
    """
    # 第一步：按 inscode 累加 historical portion，作为归一化分母
    portion_sum = defaultdict(float)
    for ha in historical:
        portion_sum[ha['inscode']] += ha.get('portion', 1)

    # 第二步：重组 As-Is，按归一化 portion 累加
    by_trty = defaultdict(list)
    for ha in historical:
        ic = ha['inscode']
        if ic not in hospital_meta:
            continue
        meta = hospital_meta[ic]
        raw_portion = ha.get('portion', 1)
        denom = portion_sum.get(ic, 1)
        norm_portion = raw_portion / denom if denom else 0
        idx = hospital_index_map.get(ic, 0) * norm_portion
        by_trty[ha['trtyCode']].append({
            'inscode': ic,
            'index': idx,
            'latitude': meta.get('latitude', 0),
            'longitude': meta.get('longitude', 0),
            'city': meta.get('city', ''),
            'district': meta.get('district', ''),
        })
    # 转 territory_results 格式
    trs = []
    for trty, hosps in by_trty.items():
        total_idx = sum(h['index'] for h in hosps)
        cities = set(h['city'] for h in hosps if h['city'])
        trs.append({
            'trtyCode': trty,
            'totalIndex': total_idx,
            'hospitalCount': len(hosps),
            'cityCount': len(cities),
            'hospitals': hosps,
        })
    return trs


def main(result_path):
    with open(result_path) as f:
        to_be = json.load(f)
    as_is_path = Path(result_path).parent / 'as-is.json'
    with open(as_is_path) as f:
        as_is = json.load(f)

    print(f'\n{"="*70}')
    print(f'  实证指标对比：{to_be["meta"].get("province")} ({to_be["meta"].get("dataset","").upper()})')
    print(f'  规模：{to_be["meta"]["hospitalsCount"]} 家医院 | {to_be["meta"]["territoriesCount"]} 辖区')
    print(f'  耗时：{to_be["meta"]["elapsedSec"]:.1f}s')
    print('='*70)

    # 构造 hospital index/meta map（从 to_be territory_results）
    # 注意：tr.hospitals[i].index 是该医院的"全 idx"（不论是否被拆分），
    # 同一 inscode 跨多个 territory 出现时不应重复累加，只记一次即可
    hospital_index_map = {}
    hospital_meta = {}
    for tr in to_be['territoryResults']:
        for h in tr['hospitals']:
            ic = h['inscode']
            if ic not in hospital_index_map:
                hospital_index_map[ic] = h.get('index', 0)
                hospital_meta[ic] = h

    # As-Is（基于 historical 重组）
    as_is_trs = compute_as_is_baseline(as_is['historical'], hospital_index_map, hospital_meta)

    # === Index 均衡度 ===
    as_is_idx = compute_index_balance(as_is_trs)
    to_be_idx = compute_index_balance(to_be['territoryResults'])
    print(f'\n--- Index 均衡度 ---')
    print(f'  指标                  As-Is             To-Be             改善')
    print(f'  辖区数                {as_is_idx["count"]:>8d}          {to_be_idx["count"]:>8d}')
    print(f'  Index 均值            {as_is_idx["mean"]:>10.1f}        {to_be_idx["mean"]:>10.1f}')
    print(f'  Index 标准差          {as_is_idx["std"]:>10.1f}        {to_be_idx["std"]:>10.1f}        {(as_is_idx["std"]-to_be_idx["std"])/as_is_idx["std"]*100:+.1f}%')
    print(f'  变异系数 CV           {as_is_idx["cv_pct"]:>9.1f}%         {to_be_idx["cv_pct"]:>9.1f}%         {(as_is_idx["cv"]-to_be_idx["cv"])/as_is_idx["cv"]*100:+.1f}%' if as_is_idx["cv"] > 0 else '')
    print(f'  最小辖区 Index        {as_is_idx["min"]:>10.1f}        {to_be_idx["min"]:>10.1f}')
    print(f'  最大辖区 Index        {as_is_idx["max"]:>10.1f}        {to_be_idx["max"]:>10.1f}')
    print(f'  超 ±20% 阈值辖区数    {as_is_idx["out_of_range_count"]:>8d} ({as_is_idx["out_of_range_pct"]:>4.1f}%)  {to_be_idx["out_of_range_count"]:>8d} ({to_be_idx["out_of_range_pct"]:>4.1f}%)')

    # === 地理紧凑性 ===
    as_is_geo = compute_geographic_compactness(as_is_trs)
    to_be_geo = compute_geographic_compactness(to_be['territoryResults'])
    print(f'\n--- 地理紧凑性 ---')
    print(f'  辖区平均最大半径      {as_is_geo["avg_max_radius_km"]:>10.1f} km     {to_be_geo["avg_max_radius_km"]:>10.1f} km     ', end='')
    diff = as_is_geo["avg_max_radius_km"] - to_be_geo["avg_max_radius_km"]
    print(f'{diff/as_is_geo["avg_max_radius_km"]*100:+.1f}%' if as_is_geo["avg_max_radius_km"] else '')
    print(f'  辖区最大半径          {as_is_geo["max_max_radius_km"]:>10.1f} km     {to_be_geo["max_max_radius_km"]:>10.1f} km')
    print(f'  辖区平均城市数        {as_is_geo["avg_city_count"]:>10.2f}        {to_be_geo["avg_city_count"]:>10.2f}')
    print(f'  超 5 城辖区数         {as_is_geo["territories_over_5_cities"]:>10d}        {to_be_geo["territories_over_5_cities"]:>10d}')

    # === 容量均衡 ===
    as_is_cap = compute_capacity_balance(as_is_trs)
    to_be_cap = compute_capacity_balance(to_be['territoryResults'])
    print(f'\n--- 容量均衡（辖区医院数）---')
    print(f'  平均 / 标准差          {as_is_cap["mean_hospitals_per_territory"]:>5.1f} / {as_is_cap["std"]:>5.1f}    {to_be_cap["mean_hospitals_per_territory"]:>5.1f} / {to_be_cap["std"]:>5.1f}')
    print(f'  min / max             {as_is_cap["min"]:>5d} / {as_is_cap["max"]:>5d}    {to_be_cap["min"]:>5d} / {to_be_cap["max"]:>5d}')

    # === 客户保留率 ===
    retention = compute_retention(as_is['historical'], to_be['assignments'], hospital_index_map)
    print(f'\n--- 客户关系保留率 ---')
    print(f'  对比基础：             {retention["total_compared_hospitals"]} 家在 As-Is 与 To-Be 都有分配的医院')
    print(f'  完全保留              {retention["fully_retained"]:>5d}')
    print(f'  部分保留              {retention["partial_retained"]:>5d}')
    print(f'  完全变动              {retention["fully_changed"]:>5d}')
    print(f'  保留率（医院数）      {retention["retention_rate_count_pct"]:>5.1f}%')
    print(f'  保留率（Index 加权）  {retention["retention_rate_idx_weighted_pct"]:>5.1f}%')

    # 输出 metrics.json
    metrics = {
        'meta': to_be['meta'],
        'index_balance': {'as_is': as_is_idx, 'to_be': to_be_idx},
        'geographic_compactness': {'as_is': as_is_geo, 'to_be': to_be_geo},
        'capacity_balance': {'as_is': as_is_cap, 'to_be': to_be_cap},
        'retention': retention,
    }
    out_path = Path(result_path).parent / 'metrics.json'
    with open(out_path, 'w') as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)
    print(f'\n→ 输出 {out_path}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python3 scripts/compute-metrics.py data/case/output/bc-上海/result.json', file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
