import { Hospital, Territory, Constraint, OptimizationResult, TerritoryResult, Assignment, LockAssignment, RegionConstraintParams, AlgorithmMode } from '@/types';

// ============================================================
// Haversine distance (km)
// ============================================================

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(a)) * R;
}

// ============================================================
// Virtual hospital (after splitting large-index hospitals)
// ============================================================

interface VirtualHospital {
  originalId: string;
  inscode: string;
  insname: string;
  district: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
  index: number;       // portion index (original / num_splits)
  sales: number;
  potential: number;
  portion: number;     // 1.0 for unsplit, 1/n for split
  splitId: number;     // 0 for unsplit, 0..n-1 for splits
  originalIndex: number; // original full index value
}

// ============================================================
// Effective constraints extracted from user input
// ============================================================

// Base penalty: 1 threshold unit of violation = this much cost
const BASE_PENALTY = 10000;

interface EffectiveConstraints {
  all: Constraint[];
  indexTarget: number;
  indexMin: number;
  indexMax: number;
  maxDistanceKm: number;
  maxCities: number;
  maxHospitals: number;
  iterations: number;
  // Thresholds: how much violation = 1 penalty unit
  indexThreshold: number;       // default 200
  distanceThreshold: number;    // default 10 (km)
  cityThreshold: number;        // default 1
  capacityThreshold: number;    // default 1
  historicalThreshold: number;  // default 200, 0 = no historical penalty
  districtThreshold: number;    // default 1, how many extra districts = 1 penalty unit
  hasHistorical: boolean;       // whether historical constraint exists
}

// Maps hospital inscode -> set of historical territory indices (supports split hospitals)
type HistoricalMap = Map<string, Set<number>>;

// Maps hospital inscode -> set of allowed territory indices (from lock assignments)
type LockMap = Map<string, Set<number>>;

function buildEffectiveConstraints(constraints: Constraint[]): EffectiveConstraints {
  const indexC = constraints.find((c) => c.type === 'index_range');
  const distC = constraints.find((c) => c.type === 'geographic_distance');
  const cityC = constraints.find((c) => c.type === 'city_limit');
  const capC = constraints.find((c) => c.type === 'capacity');
  const histC = constraints.find((c) => c.type === 'historical_stability');
  const districtC = constraints.find((c) => c.type === 'district_concentration');

  const indexMin = indexC ? Number(indexC.value) || 800 : 800;
  const indexMax = indexC?.value2 ?? 1200;

  return {
    all: constraints,
    indexTarget: (indexMin + indexMax) / 2,
    indexMin,
    indexMax,
    maxDistanceKm: distC ? Number(distC.value) || 200 : 200,
    maxCities: cityC ? Number(cityC.value) || 3 : 3,
    maxHospitals: capC ? Number(capC.value) || 15 : 15,
    // Default 500000; env var SA_ITERATIONS allows override for 5.4.2 sensitivity sweep without
    // changing the production signature. UI/SaaS path reads no env so behavior is unchanged.
    iterations: (typeof process !== 'undefined' && Number(process.env?.SA_ITERATIONS)) || 500000,
    indexThreshold: indexC?.threshold ?? 200,
    distanceThreshold: distC?.threshold ?? 10,
    cityThreshold: cityC?.threshold ?? 1,
    capacityThreshold: capC?.threshold ?? 1,
    historicalThreshold: histC?.threshold ?? 200,
    districtThreshold: districtC?.threshold ?? 1,
    hasHistorical: !!histC,
  };
}

// ============================================================
// 1. Preprocessing: split large-index hospitals
// ============================================================

function preprocessHospitals(hospitals: Hospital[], indexTarget: number = 1000): VirtualHospital[] {
  const result: VirtualHospital[] = [];
  const splitThreshold = indexTarget * 1.5; // > 1500 triggers split

  for (const h of hospitals) {
    if (h.index > splitThreshold) {
      // Equal split: n = round(index / indexTarget), each rep gets index/n
      let n = Math.round(h.index / indexTarget);
      if (n < 2) n = 2; // above splitThreshold (1.2×target) guarantees index > 1200, round(1200/1000)=1, so force 2
      const perPortion = h.index / n;

      const numSplits = n;

      const portionRatio = 1 / numSplits;
      for (let i = 0; i < numSplits; i++) {
        result.push({
          originalId: h.id,
          inscode: h.inscode,
          insname: h.insname,
          district: h.district || '',
          city: h.city,
          province: h.province,
          latitude: h.latitude,
          longitude: h.longitude,
          index: perPortion,
          sales: h.sales * portionRatio,
          potential: h.potential * portionRatio,
          portion: portionRatio,
          splitId: i,
          originalIndex: h.index,
        });
      }
    } else {
      result.push({
        originalId: h.id,
        inscode: h.inscode,
        insname: h.insname,
        district: h.district || '',
        city: h.city,
        province: h.province,
        latitude: h.latitude,
        longitude: h.longitude,
        index: h.index,
        sales: h.sales,
        potential: h.potential,
        portion: 1.0,
        splitId: 0,
        originalIndex: h.index,
      });
    }
  }

  return result;
}

// ============================================================
// 2. Group stats helper
// ============================================================

function getGroupStats(group: VirtualHospital[]): {
  idxSum: number;
  count: number;
  cities: number;
  districts: number;
  maxDist: number;
} {
  if (group.length === 0) return { idxSum: 0, count: 0, cities: 0, districts: 0, maxDist: 0 };

  const idxSum = group.reduce((s, h) => s + h.index, 0);
  const count = group.length;
  const citySet = new Set(group.map((h) => h.city).filter(Boolean));
  const cities = citySet.size;
  const districtSet = new Set(group.map((h) => h.district).filter(Boolean));
  const districts = districtSet.size;

  let maxDist = 0;
  if (group.length > 1) {
    // For large groups, sample to avoid O(n^2)
    const limit = Math.min(group.length, 30);
    for (let i = 0; i < limit; i++) {
      if (!group[i].latitude || !group[i].longitude) continue;
      for (let j = i + 1; j < limit; j++) {
        if (!group[j].latitude || !group[j].longitude) continue;
        const d = haversineKm(
          group[i].longitude, group[i].latitude,
          group[j].longitude, group[j].latitude
        );
        if (d > maxDist) maxDist = d;
      }
    }
  }

  return { idxSum, count, cities, districts, maxDist };
}

// ============================================================
// 3. Cost function (ported from Python)
// ============================================================

function calculateCost(
  assignments: VirtualHospital[][],
  ec: EffectiveConstraints,
  historicalMap?: HistoricalMap,
  lockMap?: LockMap
): number {
  let totalCost = 0;

  for (let tIdx = 0; tIdx < assignments.length; tIdx++) {
    const group = assignments[tIdx];
    if (group.length === 0) {
      totalCost += 1e8;
      continue;
    }

    const { idxSum, count, cities, districts, maxDist } = getGroupStats(group);

    // Index: penalize violation outside [indexMin, indexMax]
    // penalty = (超出量 / threshold)² × BASE_PENALTY
    // 二次惩罚：抑制 SA 把多个轻微越界换成 1 个严重越界的"集中越界"行为
    if (idxSum < ec.indexMin) {
      const ratio = (ec.indexMin - idxSum) / ec.indexThreshold;
      totalCost += ratio * ratio * BASE_PENALTY;
    } else if (idxSum > ec.indexMax) {
      const ratio = (idxSum - ec.indexMax) / ec.indexThreshold;
      totalCost += ratio * ratio * BASE_PENALTY;
    }

    // City limit (distance is handled by geographic clustering, not penalized here)
    if (cities > ec.maxCities) {
      totalCost += ((cities - ec.maxCities) / ec.cityThreshold) * BASE_PENALTY;
    }

    // Capacity limit
    if (count > ec.maxHospitals) {
      totalCost += ((count - ec.maxHospitals) / ec.capacityThreshold) * BASE_PENALTY;
    }

    // District concentration: penalize each extra district beyond 1
    // Encourages SA to keep same-district hospitals together
    if (districts > 1 && ec.districtThreshold > 0) {
      totalCost += ((districts - 1) / ec.districtThreshold) * BASE_PENALTY;
    }

    // Geographic compactness: penalize max distance from any hospital to cluster centroid
    // Uses max rather than sum/avg to specifically block outlier assignments
    {
      const withCoords = group.filter((h) => h.latitude && h.longitude);
      if (withCoords.length > 1) {
        const cLat = withCoords.reduce((s, h) => s + h.latitude, 0) / withCoords.length;
        const cLng = withCoords.reduce((s, h) => s + h.longitude, 0) / withCoords.length;
        let maxDistToCentroid = 0;
        for (const h of withCoords) {
          const d = haversineKm(h.longitude, h.latitude, cLng, cLat);
          if (d > maxDistToCentroid) maxDistToCentroid = d;
        }
        // Quadratic penalty on max distance: penalizes outliers heavily
        // 系数 3 加大软阈权重，抑制 SA 把医院推到远辖区换 cost 改善
        // 100km → 30000 (= 3× BASE_PENALTY)
        // 200km → 120000 (= 12× BASE_PENALTY)
        // 500km → 750000 (= 75× BASE_PENALTY)
        // 1000km → 3000000 (= 300× BASE_PENALTY)
        totalCost += 3 * maxDistToCentroid * maxDistToCentroid;
      }
    }

    // (Historical stability is calculated globally after the per-territory loop)

    // Lock constraint: hard penalty for hospitals not in their locked territory
    if (lockMap) {
      for (const vh of group) {
        const allowedSet = lockMap.get(vh.inscode);
        if (allowedSet && !allowedSet.has(tIdx)) {
          totalCost += 1e8; // Very high penalty to enforce hard constraint
        }
      }
    }

    // Split dispersion: enforced as hard constraint in SA move/swap (skip operations that cluster portions)
  }

  // Historical stability penalty: calculated globally per hospital
  // violation = origIndex × changeRatio, then penalty = (violation / threshold) × BASE_PENALTY
  if (historicalMap && ec.hasHistorical && ec.historicalThreshold > 0) {
    // Build current assignment: inscode -> set of current territory indices
    const currentMap = new Map<string, Set<number>>();
    for (let tIdx = 0; tIdx < assignments.length; tIdx++) {
      for (const vh of assignments[tIdx]) {
        if (!currentMap.has(vh.inscode)) currentMap.set(vh.inscode, new Set());
        currentMap.get(vh.inscode)!.add(tIdx);
      }
    }

    for (const [inscode, histSet] of historicalMap) {
      const currSet = currentMap.get(inscode);
      if (!currSet) continue;

      const histCount = histSet.size;
      let changedCount = 0;
      for (const hIdx of histSet) {
        if (!currSet.has(hIdx)) changedCount++;
      }

      if (changedCount > 0) {
        let origIndex = 0;
        for (let tIdx = 0; tIdx < assignments.length; tIdx++) {
          for (const vh of assignments[tIdx]) {
            if (vh.inscode === inscode) { origIndex = vh.originalIndex; break; }
          }
          if (origIndex > 0) break;
        }

        const changeRatio = changedCount / histCount;
        const violation = origIndex * changeRatio;
        totalCost += (violation / ec.historicalThreshold) * BASE_PENALTY;
      }
    }
  }

  return totalCost;
}

// ============================================================
// 3b. 城市亲和关系：历史上同一辖区内的城市互为亲和
// ============================================================

type CityAffinityMap = Map<string, Set<string>>;

function buildCityAffinity(
  hospitals: Hospital[],
  historicalAssignments?: import('@/types').HistoricalAssignment[]
): CityAffinityMap {
  const affinity: CityAffinityMap = new Map();
  if (!historicalAssignments || historicalAssignments.length === 0) return affinity;

  // 按 trtyCode 分组，收集每个辖区包含的城市
  const trtyToCities = new Map<string, Set<string>>();
  const hospitalCityMap = new Map(hospitals.map(h => [h.inscode, h.city]));
  for (const ha of historicalAssignments) {
    const city = hospitalCityMap.get(ha.inscode);
    if (!city) continue;
    if (!trtyToCities.has(ha.trtyCode)) trtyToCities.set(ha.trtyCode, new Set());
    trtyToCities.get(ha.trtyCode)!.add(city);
  }

  // 同一辖区内的城市互为亲和（不跨辖区传递）
  for (const cities of trtyToCities.values()) {
    if (cities.size <= 1) continue;
    const cityArr = [...cities];
    for (let i = 0; i < cityArr.length; i++) {
      for (let j = i + 1; j < cityArr.length; j++) {
        if (!affinity.has(cityArr[i])) affinity.set(cityArr[i], new Set());
        if (!affinity.has(cityArr[j])) affinity.set(cityArr[j], new Set());
        affinity.get(cityArr[i])!.add(cityArr[j]);
        affinity.get(cityArr[j])!.add(cityArr[i]);
      }
    }
  }
  return affinity;
}

// ============================================================
// 3c. 一对一城市：城市只属于 1 个辖区 且 该辖区只有 1 个城市
// ============================================================

function buildExclusiveCities(
  hospitals: Hospital[],
  historicalAssignments?: import('@/types').HistoricalAssignment[]
): Set<string> {
  const exclusive = new Set<string>();
  if (!historicalAssignments || historicalAssignments.length === 0) return exclusive;

  const hospitalCityMap = new Map(hospitals.map(h => [h.inscode, h.city]));

  // 城市 → 出现过的辖区集合
  const cityToTrtys = new Map<string, Set<string>>();
  // 辖区 → 包含的城市集合
  const trtyToCities = new Map<string, Set<string>>();

  for (const ha of historicalAssignments) {
    const city = hospitalCityMap.get(ha.inscode);
    if (!city) continue;
    if (!cityToTrtys.has(city)) cityToTrtys.set(city, new Set());
    cityToTrtys.get(city)!.add(ha.trtyCode);
    if (!trtyToCities.has(ha.trtyCode)) trtyToCities.set(ha.trtyCode, new Set());
    trtyToCities.get(ha.trtyCode)!.add(city);
  }

  // 双向一对一：城市只属于 1 个辖区 且 该辖区也只包含 1 个城市
  // 业务规则:这种城市的 rep 是"专属 rep",一对一城市簇必须独立成 territory,不接收外部医院
  for (const [city, trtys] of cityToTrtys) {
    if (trtys.size !== 1) continue;
    const trtyCode = [...trtys][0];
    const trtyCities = trtyToCities.get(trtyCode);
    if (trtyCities && trtyCities.size === 1) {
      exclusive.add(city);
    }
  }

  console.log(`[exclusiveCities] 双向一对一城市: ${exclusive.size} 个 (${[...exclusive].join(', ')})`);
  return exclusive;
}

// ============================================================
// 4a. Four-layer clustering: big hospitals → districts → cities → combination
// ============================================================

function fourLayerClustering(
  hospitals: VirtualHospital[],
  n: number,
  maxCities: number,
  indexTarget: number,
  lockMap?: LockMap,
  cityAffinity?: CityAffinityMap,
  maxDistanceKm: number = 200,
  exclusiveCities?: Set<string>,
  outClusterLayer?: number[]  // 输出参数:每个 cluster 的层级标记(0=L0 专属,后续 SA 不能写入)
): VirtualHospital[][] {
  if (hospitals.length <= n) {
    // Fewer hospitals than clusters: one per cluster
    const clusters: VirtualHospital[][] = Array.from({ length: n }, () => []);
    hospitals.forEach((h, i) => clusters[i % n].push(h));
    return clusters;
  }

  const indexMin = indexTarget * 0.8; // 800 by default
  const clusters: VirtualHospital[][] = [];
  const clusterLayer: number[] = []; // 每个 cluster 来自哪一层（0-6）;0 = 一对一城市专属簇,后续阶段不可写入
  const assigned = new Set<number>(); // indices into hospitals[] that are already assigned

  // --- Layer 0: 一对一城市强制独立成簇（最高优先级,优先占 slot）---
  // 设计意图:一对一城市必须独立成 territory,后续阶段不能往这些簇里塞其他医院
  // 标记 clusterLayer = 0,后面 1b/兜底/rebalance/L6 都会跳过 L0 簇
  if (exclusiveCities && exclusiveCities.size > 0) {
    const exclusiveCityHosps = new Map<string, number[]>();
    for (let i = 0; i < hospitals.length; i++) {
      const city = hospitals[i].city;
      if (city && exclusiveCities.has(city)) {
        if (!exclusiveCityHosps.has(city)) exclusiveCityHosps.set(city, []);
        exclusiveCityHosps.get(city)!.push(i);
      }
    }
    // 按 totalIndex 降序：高 index 的一对一城市先占 slot（slot 真不够时优先保护）
    const sortedExcCities = [...exclusiveCityHosps.entries()].sort((a, b) => {
      const aIdx = a[1].reduce((s, i) => s + hospitals[i].index, 0);
      const bIdx = b[1].reduce((s, i) => s + hospitals[i].index, 0);
      return bIdx - aIdx;
    });
    for (const [, indices] of sortedExcCities) {
      if (clusters.length >= n) break;
      const cluster: VirtualHospital[] = indices.map(i => hospitals[i]);
      indices.forEach(i => assigned.add(i));
      clusters.push(cluster);
      clusterLayer.push(0);
    }
  }

  // --- Layer 1: Big hospitals and split portions ---
  // Phase 1a: VHs with index >= indexTarget get their own cluster
  for (let i = 0; i < hospitals.length; i++) {
    if (assigned.has(i)) continue;
    if (hospitals[i].index >= indexTarget && clusters.length < n) {
      clusters.push([hospitals[i]]); clusterLayer.push(1);
      assigned.add(i);
    }
  }

  // Phase 1b: all remaining split portions (portion < 1) must be dispersed
  // into different clusters — never two portions of the same hospital in one cluster
  for (let i = 0; i < hospitals.length; i++) {
    if (assigned.has(i)) continue;
    const vh = hospitals[i];
    if (vh.portion >= 0.999) continue; // not a split portion

    // Try to create a new cluster if possible
    if (clusters.length < n) {
      clusters.push([vh]); clusterLayer.push(1);
      assigned.add(i);
      continue;
    }

    // Find cluster with lowest index that doesn't have this originalId
    // 跳过 L0 一对一城市专属簇
    let bestCluster = -1;
    let bestIndex = Infinity;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (clusterLayer[ci] === 0) continue;
      if (clusters[ci].some(v => v.originalId === vh.originalId)) continue;
      const clusterIdx = clusters[ci].reduce((s, v) => s + v.index, 0);
      if (clusterIdx < bestIndex) {
        bestIndex = clusterIdx;
        bestCluster = ci;
      }
    }
    if (bestCluster >= 0) {
      clusters[bestCluster].push(vh);
      assigned.add(i);
    }
  }

  // --- Layer 2: Districts ---
  // Group remaining hospitals by district, find districts with enough index
  const districtMap = new Map<string, { indices: number[]; totalIndex: number }>();
  for (let i = 0; i < hospitals.length; i++) {
    if (assigned.has(i)) continue;
    const dist = hospitals[i].district || '';
    if (!dist) continue;
    if (!districtMap.has(dist)) districtMap.set(dist, { indices: [], totalIndex: 0 });
    const d = districtMap.get(dist)!;
    d.indices.push(i);
    d.totalIndex += hospitals[i].index;
  }

  // Districts with index >= indexMin can form clusters
  const districtsByIndex = Array.from(districtMap.entries())
    .filter(([, d]) => d.totalIndex >= indexMin)
    .sort((a, b) => b[1].totalIndex - a[1].totalIndex);

  for (const [, d] of districtsByIndex) {
    if (clusters.length >= n) break;
    const numClusters = Math.min(
      Math.round(d.totalIndex / indexTarget),
      n - clusters.length
    );
    if (numClusters <= 0) continue;

    if (numClusters === 1) {
      const cluster: VirtualHospital[] = [];
      for (const idx of d.indices) {
        if (!assigned.has(idx)) {
          cluster.push(hospitals[idx]);
          assigned.add(idx);
        }
      }
      if (cluster.length > 0) { clusters.push(cluster); clusterLayer.push(2); }
    } else {
      // Multiple clusters from one district: use Maximin to select seeds, then assign
      const available = d.indices.filter((idx) => !assigned.has(idx));
      const seeds = maximinSelect(hospitals, available, numClusters);
      const subClusters: VirtualHospital[][] = seeds.map((sIdx) => [hospitals[sIdx]]);
      const seedAssigned = new Set(seeds);

      for (const idx of available) {
        if (seedAssigned.has(idx)) continue;
        let bestCluster = 0;
        let bestDist = Infinity;
        for (let ci = 0; ci < subClusters.length; ci++) {
          const seed = subClusters[ci][0];
          const dist = haversineKm(hospitals[idx].longitude, hospitals[idx].latitude, seed.longitude, seed.latitude);
          if (dist < bestDist) { bestDist = dist; bestCluster = ci; }
        }
        subClusters[bestCluster].push(hospitals[idx]);
      }

      for (const sc of subClusters) {
        if (clusters.length >= n) break;
        clusters.push(sc); clusterLayer.push(2);
      }
      for (const idx of available) assigned.add(idx);
    }
  }

  // --- Layer 3: Cities ---
  // Group remaining hospitals by city
  const cityMap = new Map<string, { indices: number[]; totalIndex: number }>();
  for (let i = 0; i < hospitals.length; i++) {
    if (assigned.has(i)) continue;
    const city = hospitals[i].city || '未知';
    if (!cityMap.has(city)) cityMap.set(city, { indices: [], totalIndex: 0 });
    const c = cityMap.get(city)!;
    c.indices.push(i);
    c.totalIndex += hospitals[i].index;
  }

  // 一对一城市不受 indexMin 限制，强制独立成簇，且优先占 slot
  const citiesByIndex = Array.from(cityMap.entries())
    .filter(([city, c]) => c.totalIndex >= indexMin || (exclusiveCities && exclusiveCities.has(city)))
    .sort((a, b) => {
      // 一对一城市优先
      const aExcl = exclusiveCities && exclusiveCities.has(a[0]) ? 1 : 0;
      const bExcl = exclusiveCities && exclusiveCities.has(b[0]) ? 1 : 0;
      if (aExcl !== bExcl) return bExcl - aExcl;
      return b[1].totalIndex - a[1].totalIndex;
    });

  for (const [cityName, c] of citiesByIndex) {
    if (clusters.length >= n) break;
    let numClusters = Math.min(
      Math.round(c.totalIndex / indexTarget),
      n - clusters.length
    );
    // 一对一城市至少独立成 1 个簇
    if (numClusters <= 0 && exclusiveCities && exclusiveCities.has(cityName)) {
      numClusters = 1;
    }
    if (numClusters <= 0) continue;

    const available = c.indices.filter((idx) => !assigned.has(idx));
    if (available.length === 0) continue;

    if (numClusters === 1) {
      const cluster: VirtualHospital[] = [];
      for (const idx of available) {
        cluster.push(hospitals[idx]);
        assigned.add(idx);
      }
      if (cluster.length > 0) { clusters.push(cluster); clusterLayer.push(3); }
    } else {
      const seeds = maximinSelect(hospitals, available, numClusters);
      const subClusters: VirtualHospital[][] = seeds.map((sIdx) => [hospitals[sIdx]]);
      const seedAssigned = new Set(seeds);

      for (const idx of available) {
        if (seedAssigned.has(idx)) continue;
        let bestCluster = 0;
        let bestDist = Infinity;
        for (let ci = 0; ci < subClusters.length; ci++) {
          const seed = subClusters[ci][0];
          const dist = haversineKm(hospitals[idx].longitude, hospitals[idx].latitude, seed.longitude, seed.latitude);
          if (dist < bestDist) { bestDist = dist; bestCluster = ci; }
        }
        subClusters[bestCluster].push(hospitals[idx]);
      }

      // 过小的 sub-cluster 归并到同城市最近的 sub-cluster
      for (let si = subClusters.length - 1; si >= 0; si--) {
        const scIdx = subClusters[si].reduce((s, h) => s + h.index, 0);
        if (scIdx >= indexMin * 0.3 || subClusters.length <= 1) continue;
        const scLat = subClusters[si].reduce((s, h) => s + h.latitude, 0) / subClusters[si].length;
        const scLng = subClusters[si].reduce((s, h) => s + h.longitude, 0) / subClusters[si].length;
        let bestSc = -1, bestD = Infinity;
        for (let sj = 0; sj < subClusters.length; sj++) {
          if (sj === si) continue;
          const lat2 = subClusters[sj].reduce((s, h) => s + h.latitude, 0) / subClusters[sj].length;
          const lng2 = subClusters[sj].reduce((s, h) => s + h.longitude, 0) / subClusters[sj].length;
          const d = haversineKm(scLng, scLat, lng2, lat2);
          if (d < bestD) { bestD = d; bestSc = sj; }
        }
        if (bestSc >= 0) {
          subClusters[bestSc].push(...subClusters[si]);
          subClusters.splice(si, 1);
        }
      }

      for (const sc of subClusters) {
        if (clusters.length >= n) break;
        clusters.push(sc); clusterLayer.push(3);
      }
      for (const idx of available) assigned.add(idx);
    }
  }

  // --- Layer 4: Combination ---
  // Remaining unassigned hospitals (from small cities/districts)
  // Group by city, then merge nearby city groups by geographic distance
  const remainingCities = new Map<string, number[]>();
  for (let i = 0; i < hospitals.length; i++) {
    if (assigned.has(i)) continue;
    const city = hospitals[i].city || '未知';
    if (!remainingCities.has(city)) remainingCities.set(city, []);
    remainingCities.get(city)!.push(i);
  }

  if (remainingCities.size > 0 && clusters.length < n) {
    // 构建城市组：每个城市一个组，含质心和 index
    let cityGroups = Array.from(remainingCities.entries()).map(([city, indices]) => {
      const hosps = indices.map((i) => hospitals[i]);
      const lat = hosps.reduce((s, h) => s + h.latitude, 0) / hosps.length;
      const lng = hosps.reduce((s, h) => s + h.longitude, 0) / hosps.length;
      const totalIndex = hosps.reduce((s, h) => s + h.index, 0);
      return { city, indices, lat, lng, totalIndex };
    });

    // --- Layer 5: 亲和预合并 ---
    // 直接亲和的城市对合并（每个城市只参与一次，不传递）
    if (cityAffinity && cityAffinity.size > 0) {
      const mergedCities = new Set<string>();

      const affinityPairs: { i: number; j: number; dist: number }[] = [];
      for (let i = 0; i < cityGroups.length; i++) {
        const partners = cityAffinity.get(cityGroups[i].city);
        if (!partners) continue;
        for (let j = i + 1; j < cityGroups.length; j++) {
          if (partners.has(cityGroups[j].city)) {
            const d = haversineKm(cityGroups[i].lng, cityGroups[i].lat, cityGroups[j].lng, cityGroups[j].lat);
            affinityPairs.push({ i, j, dist: d });
          }
        }
      }
      affinityPairs.sort((a, b) => a.dist - b.dist);

      const toMerge: [number, number][] = [];
      for (const pair of affinityPairs) {
        if (mergedCities.has(cityGroups[pair.i].city) || mergedCities.has(cityGroups[pair.j].city)) continue;
        toMerge.push([pair.i, pair.j]);
        mergedCities.add(cityGroups[pair.i].city);
        mergedCities.add(cityGroups[pair.j].city);
      }

      const removeIndices = new Set<number>();
      for (const [i, j] of toMerge) {
        const merged = cityGroups[i];
        const other = cityGroups[j];
        const totalCount = merged.indices.length + other.indices.length;
        merged.lat = (merged.lat * merged.indices.length + other.lat * other.indices.length) / totalCount;
        merged.lng = (merged.lng * merged.indices.length + other.lng * other.indices.length) / totalCount;
        merged.indices.push(...other.indices);
        merged.totalIndex += other.totalIndex;
        merged.city = merged.city + '+' + other.city;
        removeIndices.add(j);
      }
      if (removeIndices.size > 0) {
        cityGroups = cityGroups.filter((_, idx) => !removeIndices.has(idx));
      }
    }

    // 亲和合并后的城市组先占用 slot，生成 cluster
    // 能独立成 cluster 的组（有 slot 时）直接生成
    for (const group of cityGroups) {
      if (clusters.length >= n) break;
      const cluster: VirtualHospital[] = [];
      for (const idx of group.indices) {
        cluster.push(hospitals[idx]);
        assigned.add(idx);
      }
      if (cluster.length > 0) { clusters.push(cluster); clusterLayer.push(5); }
    }

    // --- Layer 6: 落单城市归属 ---
    // cluster 数量超过 n 时，多余的 cluster 按距离归属到最近的已有 cluster（受 maxCities 约束）
    if (clusters.length > n) {
      const clusterCentroids = clusters.map(cl => ({
        lat: cl.reduce((s, h) => s + h.latitude, 0) / (cl.length || 1),
        lng: cl.reduce((s, h) => s + h.longitude, 0) / (cl.length || 1),
      }));
      const clusterCitySets = clusters.map(cl =>
        new Set(cl.map(h => h.city).filter(Boolean))
      );

      // 从最小 index 的 Layer 5 cluster 开始归属
      while (clusters.length > n) {
        let srcIdx = -1, srcIndex = Infinity;
        for (let ci = 0; ci < clusters.length; ci++) {
          if (clusterLayer[ci] < 5) continue;
          const idx = clusters[ci].reduce((s, h) => s + h.index, 0);
          if (idx < srcIndex) { srcIndex = idx; srcIdx = ci; }
        }
        if (srcIdx < 0) break;

        const srcCentroid = clusterCentroids[srcIdx];
        const srcCities = clusterCitySets[srcIdx];

        // 在所有已有 cluster 中按距离找最近的（受 maxCities 约束）
        // 跳过 L0 一对一城市专属簇,不能往里塞跨城市的医院
        let bestTarget = -1, bestDist = Infinity;
        for (let ci = 0; ci < clusters.length; ci++) {
          if (ci === srcIdx) continue;
          if (clusterLayer[ci] === 0) continue;
          if (maxCities > 0) {
            const mergedCities = new Set([...clusterCitySets[ci], ...srcCities]);
            if (mergedCities.size > maxCities) continue;
          }
          const d = haversineKm(srcCentroid.lng, srcCentroid.lat, clusterCentroids[ci].lng, clusterCentroids[ci].lat);
          if (d < bestDist) { bestDist = d; bestTarget = ci; }
        }

        if (bestTarget < 0) break;

        // 执行归属
        clusters[bestTarget].push(...clusters[srcIdx]);
        const tLen = clusters[bestTarget].length;
        clusterCentroids[bestTarget] = {
          lat: clusters[bestTarget].reduce((s, h) => s + h.latitude, 0) / tLen,
          lng: clusters[bestTarget].reduce((s, h) => s + h.longitude, 0) / tLen,
        };
        for (const c of srcCities) clusterCitySets[bestTarget].add(c);

        clusters.splice(srcIdx, 1);
        clusterLayer.splice(srcIdx, 1);
        clusterCentroids.splice(srcIdx, 1);
        clusterCitySets.splice(srcIdx, 1);
      }
    }
  }

  // Any remaining unassigned hospitals: assign to nearest cluster
  // 跳过 L0 一对一城市专属簇
  for (let i = 0; i < hospitals.length; i++) {
    if (assigned.has(i)) continue;
    if (clusters.length === 0) { clusters.push([]); clusterLayer.push(99); }
    let bestCluster = -1;
    let bestDist = Infinity;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (clusterLayer[ci] === 0) continue;
      if (clusters[ci].length === 0) continue;
      const centroid = {
        lat: clusters[ci].reduce((s, h) => s + h.latitude, 0) / clusters[ci].length,
        lng: clusters[ci].reduce((s, h) => s + h.longitude, 0) / clusters[ci].length,
      };
      const d = haversineKm(hospitals[i].longitude, hospitals[i].latitude, centroid.lng, centroid.lat);
      if (d < bestDist) { bestDist = d; bestCluster = ci; }
    }
    if (bestCluster < 0) {
      // 兜底 fallback：所有非 L0 簇都为空,只能塞 L0(应该极少发生)
      for (let ci = 0; ci < clusters.length; ci++) {
        if (clusters[ci].length > 0) { bestCluster = ci; break; }
      }
      if (bestCluster < 0) bestCluster = 0;
    }
    clusters[bestCluster].push(hospitals[i]);
    assigned.add(i);
  }

  // If we have fewer clusters than n, split the largest cluster
  // 跳过 L0 一对一城市专属簇,不能拆分破坏专属
  while (clusters.length < n) {
    // Find cluster with highest total index
    let maxIdx = 0;
    let maxCluster = -1;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (clusterLayer[ci] === 0) continue;
      const idx = clusters[ci].reduce((s, h) => s + h.index, 0);
      if (idx > maxIdx && clusters[ci].length >= 2) { maxIdx = idx; maxCluster = ci; }
    }
    if (maxCluster < 0 || clusters[maxCluster].length < 2) break;

    // Split using Maximin: pick 2 seeds, assign rest to nearest
    const clusterHosps = clusters[maxCluster];
    const indices = clusterHosps.map((_, i) => i);
    const seedsLocal = maximinSelect(clusterHosps, indices, 2);
    const a: VirtualHospital[] = [clusterHosps[seedsLocal[0]]];
    const b: VirtualHospital[] = [clusterHosps[seedsLocal[1]]];
    for (let i = 0; i < clusterHosps.length; i++) {
      if (i === seedsLocal[0] || i === seedsLocal[1]) continue;
      const dA = haversineKm(clusterHosps[i].longitude, clusterHosps[i].latitude, a[0].longitude, a[0].latitude);
      const dB = haversineKm(clusterHosps[i].longitude, clusterHosps[i].latitude, b[0].longitude, b[0].latitude);
      if (dA <= dB) a.push(clusterHosps[i]);
      else b.push(clusterHosps[i]);
    }
    clusters[maxCluster] = a;
    clusters.push(b);
  }

  // Rebalance: ensure every cluster has at least one hospital.
  // Donate the nearest hospital from the largest neighboring cluster.
  // 跳过 L0 簇:既不让 L0 簇捐医院（保护一对一城市专属）,也不修复空 L0 簇（不会发生）
  for (let ci = 0; ci < clusters.length; ci++) {
    if (clusters[ci].length > 0) continue;
    if (clusterLayer[ci] === 0) continue;

    // Find the cluster with the most hospitals to donate from
    let donorIdx = -1;
    let donorSize = 0;
    for (let di = 0; di < clusters.length; di++) {
      if (di === ci || clusters[di].length <= 1) continue;
      if (clusterLayer[di] === 0) continue;
      if (clusters[di].length > donorSize) {
        donorSize = clusters[di].length;
        donorIdx = di;
      }
    }
    if (donorIdx < 0) continue;

    // Pick the hospital with the lowest index from the donor (least disruption)
    let bestHi = 0;
    let bestIndex = Infinity;
    for (let hi = 0; hi < clusters[donorIdx].length; hi++) {
      const vh = clusters[donorIdx][hi];
      // Don't move locked hospitals out of their allowed clusters
      if (lockMap) {
        const allowed = lockMap.get(vh.inscode);
        if (allowed && !allowed.has(ci)) continue;
      }
      if (vh.index < bestIndex) {
        bestIndex = vh.index;
        bestHi = hi;
      }
    }
    const donated = clusters[donorIdx].splice(bestHi, 1)[0];
    clusters[ci].push(donated);
  }

  // 输出 clusterLayer 供调用者使用（runOptimization 用 L0 标记保护一对一城市专属簇）
  if (outClusterLayer) {
    outClusterLayer.length = 0;
    for (const l of clusterLayer) outClusterLayer.push(l);
  }

  // 聚类结果日志
  console.log(`\n[聚类结果] ${clusters.length} 个 cluster（目标 ${n}）`);
  console.log(`${'#'.padEnd(4)} ${'层级'.padEnd(5)} ${'Index'.padStart(8)} ${'医院'.padStart(5)} ${'城市'.padStart(5)}  城市列表`);
  console.log('-'.repeat(80));
  for (let ci = 0; ci < clusters.length; ci++) {
    const cl = clusters[ci];
    const idx = cl.reduce((s, h) => s + h.index, 0);
    const cities = [...new Set(cl.map(h => h.city).filter(Boolean))];
    const layer = ci < clusterLayer.length ? clusterLayer[ci] : '?';
    console.log(
      `${String(ci + 1).padEnd(4)} L${String(layer).padEnd(4)} ${idx.toFixed(0).padStart(8)} ${String(cl.length).padStart(5)} ${String(cities.length).padStart(5)}  ${cities.join(', ')}`
    );
    // 详细医院列表
    for (const h of cl) {
      const p = h.portion < 0.999 ? ` p=${h.portion.toFixed(1)}` : '';
      console.log(`       ${(h.insname || '').substring(0, 20).padEnd(22)} ${(h.city || '').padEnd(10)} idx=${h.index.toFixed(0)}${p}`);
    }
  }
  console.log('');

  return clusters;
}

// Maximin selection: pick k indices from candidates that are maximally spread
function maximinSelect(hospitals: VirtualHospital[], candidates: number[], k: number): number[] {
  if (candidates.length <= k) return [...candidates];

  // First seed: highest index
  let bestIdx = candidates[0];
  let bestIndex = hospitals[candidates[0]].index;
  for (const idx of candidates) {
    if (hospitals[idx].index > bestIndex) { bestIndex = hospitals[idx].index; bestIdx = idx; }
  }

  const selected = [bestIdx];
  const remaining = candidates.filter((i) => i !== bestIdx);

  while (selected.length < k && remaining.length > 0) {
    let bestCandidate = -1;
    let bestMinDist = -1;

    for (let ci = 0; ci < remaining.length; ci++) {
      const cand = hospitals[remaining[ci]];
      let minDist = Infinity;
      for (const sIdx of selected) {
        const d = haversineKm(cand.longitude, cand.latitude, hospitals[sIdx].longitude, hospitals[sIdx].latitude);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) { bestMinDist = minDist; bestCandidate = ci; }
    }

    if (bestCandidate >= 0) {
      selected.push(remaining[bestCandidate]);
      remaining.splice(bestCandidate, 1);
    } else {
      break;
    }
  }

  return selected;
}

// Legacy wrapper — kept for compatibility with runOptimization
function selectSeeds(hospitals: VirtualHospital[], n: number): number[] {
  if (hospitals.length <= n) return hospitals.map((_, i) => i);

  // Group by city
  const cityMap = new Map<string, { idx: number; index: number }[]>();
  for (let i = 0; i < hospitals.length; i++) {
    const city = hospitals[i].city || '未知';
    if (!cityMap.has(city)) cityMap.set(city, []);
    cityMap.get(city)!.push({ idx: i, index: hospitals[i].index });
  }

  // Calculate total index per city, sort by total index descending
  const cities = Array.from(cityMap.entries())
    .map(([city, members]) => ({
      city,
      members: members.sort((a, b) => b.index - a.index),
      totalIndex: members.reduce((s, m) => s + m.index, 0),
    }))
    .sort((a, b) => b.totalIndex - a.totalIndex);

  const totalIndex = cities.reduce((s, c) => s + c.totalIndex, 0);
  const idealPerSeed = totalIndex / n;

  // Allocate seeds per city proportional to index
  // Cities with enough index get proportional seeds; small cities may get 0
  const citySeeds = new Map<string, number>();
  const fractions = cities.map((c) => ({
    city: c.city,
    fraction: c.totalIndex / idealPerSeed,
  }));

  // Assign integer parts first
  let allocated = 0;
  for (const f of fractions) {
    const intPart = Math.floor(f.fraction);
    citySeeds.set(f.city, intPart);
    allocated += intPart;
  }

  // Assign remaining by largest fractional remainder
  let remaining = n - allocated;
  if (remaining > 0) {
    const byRemainder = fractions
      .map((f) => ({ city: f.city, rem: f.fraction - Math.floor(f.fraction) }))
      .sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < remaining && i < byRemainder.length; i++) {
      citySeeds.set(byRemainder[i].city, (citySeeds.get(byRemainder[i].city) || 0) + 1);
    }
  }

  // Select actual seed hospitals within each city using Maximin (city-local)
  const seeds: number[] = [];

  for (const c of cities) {
    const numSeeds = Math.min(citySeeds.get(c.city) || 0, c.members.length);
    if (numSeeds === 0) continue;

    // First seed: highest index in this city
    const citySelectedIdx: number[] = [c.members[0].idx];
    seeds.push(c.members[0].idx);

    // Additional seeds: Maximin within city (only compare to same-city seeds)
    const candidates = c.members.slice(1);
    for (let s = 1; s < numSeeds && candidates.length > 0; s++) {
      let bestCandidate = -1;
      let bestMinDist = -1;

      for (let ci = 0; ci < candidates.length; ci++) {
        const cand = hospitals[candidates[ci].idx];
        let minDist = Infinity;
        for (const sIdx of citySelectedIdx) {
          const d = haversineKm(cand.longitude, cand.latitude, hospitals[sIdx].longitude, hospitals[sIdx].latitude);
          if (d < minDist) minDist = d;
        }
        if (minDist > bestMinDist) {
          bestMinDist = minDist;
          bestCandidate = ci;
        }
      }

      if (bestCandidate >= 0) {
        seeds.push(candidates[bestCandidate].idx);
        citySelectedIdx.push(candidates[bestCandidate].idx);
        candidates.splice(bestCandidate, 1);
      }
    }
  }

  return seeds;
}

// Constrained geographic clustering: assign hospitals to nearest seed,
// respecting city count limit. Returns cluster assignments (hospitalIdx -> clusterIdx).
function geographicClustering(
  hospitals: VirtualHospital[],
  n: number,
  maxCities: number,
  lockMap?: LockMap,
): VirtualHospital[][] {
  if (hospitals.length === 0 || n <= 1) return [hospitals];

  const seedIndices = selectSeeds(hospitals, n);
  const clusters: VirtualHospital[][] = Array.from({ length: n }, () => []);
  const clusterCities: Set<string>[] = Array.from({ length: n }, () => new Set());

  // Place seed hospitals in their clusters
  for (let ci = 0; ci < seedIndices.length; ci++) {
    const vh = hospitals[seedIndices[ci]];
    clusters[ci].push(vh);
    if (vh.city) clusterCities[ci].add(vh.city);
  }

  // Pre-compute distance from each hospital to each seed
  const seedHospitals = seedIndices.map((i) => hospitals[i]);
  const distToSeed: number[][] = hospitals.map((h) =>
    seedHospitals.map((s) =>
      haversineKm(h.longitude, h.latitude, s.longitude, s.latitude)
    )
  );

  // Sort non-seed hospitals by distance to their nearest seed (closest first)
  const nonSeedIndices = hospitals
    .map((_, i) => i)
    .filter((i) => !new Set(seedIndices).has(i));

  nonSeedIndices.sort((a, b) => {
    const minA = Math.min(...distToSeed[a]);
    const minB = Math.min(...distToSeed[b]);
    return minA - minB;
  });

  // Assign each hospital to nearest feasible cluster
  for (const hIdx of nonSeedIndices) {
    const vh = hospitals[hIdx];

    // If locked, must go to allowed cluster
    if (lockMap) {
      const allowedSet = lockMap.get(vh.inscode);
      if (allowedSet && allowedSet.size > 0) {
        const allowedArr = Array.from(allowedSet).filter((idx) => idx < n);
        if (allowedArr.length > 0) {
          const tIdx = allowedArr[vh.splitId % allowedArr.length];
          clusters[tIdx].push(vh);
          if (vh.city) clusterCities[tIdx].add(vh.city);
          continue;
        }
      }
    }

    // Sort clusters by distance to this hospital
    const clusterOrder = distToSeed[hIdx]
      .map((d, ci) => ({ ci, dist: d }))
      .sort((a, b) => a.dist - b.dist);

    let assigned = false;
    for (const { ci } of clusterOrder) {
      // Check city limit: if hospital's city is already in cluster, always OK
      // If not, check if adding a new city would exceed limit
      const cityOk = !vh.city ||
        clusterCities[ci].has(vh.city) ||
        clusterCities[ci].size < maxCities;

      // Check split dispersion: no two portions of same hospital in same cluster
      const splitOk = vh.portion >= 0.999 ||
        !clusters[ci].some((v) => v.originalId === vh.originalId);

      if (cityOk && splitOk) {
        clusters[ci].push(vh);
        if (vh.city) clusterCities[ci].add(vh.city);
        assigned = true;
        break;
      }
    }

    // Fallback: splitOk is mandatory (hard constraint), relax cityOk only
    if (!assigned) {
      let fallbackAssigned = false;
      for (const { ci } of clusterOrder) {
        const splitOk = vh.portion >= 0.999 ||
          !clusters[ci].some((v) => v.originalId === vh.originalId);
        if (splitOk) {
          clusters[ci].push(vh);
          if (vh.city) clusterCities[ci].add(vh.city);
          fallbackAssigned = true;
          break;
        }
      }
      // Last resort: all clusters already have a portion of this hospital (shouldn't happen if n >= numSplits)
      if (!fallbackAssigned) {
        const nearest = clusterOrder[0].ci;
        clusters[nearest].push(vh);
        if (vh.city) clusterCities[nearest].add(vh.city);
      }
    }
  }

  return clusters;
}

// Build adjacency map: which clusters share a city or are geographically close
function buildAdjacency(clusters: VirtualHospital[][], seedIndices?: number[], hospitals?: VirtualHospital[]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < clusters.length; i++) {
    adj.set(i, new Set());
  }

  // Clusters sharing a city are adjacent
  const cityToCluster = new Map<string, number[]>();
  for (let ci = 0; ci < clusters.length; ci++) {
    const cities = new Set(clusters[ci].map((h) => h.city).filter(Boolean));
    for (const city of cities) {
      if (!cityToCluster.has(city)) cityToCluster.set(city, []);
      cityToCluster.get(city)!.push(ci);
    }
  }
  for (const [, cis] of cityToCluster) {
    for (let i = 0; i < cis.length; i++) {
      for (let j = i + 1; j < cis.length; j++) {
        adj.get(cis[i])!.add(cis[j]);
        adj.get(cis[j])!.add(cis[i]);
      }
    }
  }

  // Also add geographic neighbors: each cluster is adjacent to its 3 nearest clusters
  if (clusters.length > 2) {
    const centroids = clusters.map((cl) => {
      if (cl.length === 0) return { lat: 0, lng: 0 };
      const lat = cl.reduce((s, h) => s + h.latitude, 0) / cl.length;
      const lng = cl.reduce((s, h) => s + h.longitude, 0) / cl.length;
      return { lat, lng };
    });

    for (let i = 0; i < clusters.length; i++) {
      const dists = centroids
        .map((c, j) => ({ j, d: j === i ? Infinity : haversineKm(centroids[i].lng, centroids[i].lat, c.lng, c.lat) }))
        .sort((a, b) => a.d - b.d);

      const neighbors = Math.min(3, clusters.length - 1);
      for (let k = 0; k < neighbors; k++) {
        adj.get(i)!.add(dists[k].j);
        adj.get(dists[k].j)!.add(i);
      }
    }
  }

  return adj;
}

// ============================================================
// 4b. Local search optimization (SA) — operates on clustered assignments
// ============================================================

function runOptimization(
  virtualHospitals: VirtualHospital[],
  territoryCount: number,
  ec: EffectiveConstraints,
  historicalMap?: HistoricalMap,
  lockMap?: LockMap,
  cityAffinity?: CityAffinityMap,
  exclusiveCities?: Set<string>
): VirtualHospital[][] {
  // Single territory: assign all hospitals directly, no optimization needed
  if (territoryCount <= 1) {
    return [virtualHospitals];
  }

  // Phase 1: Four-layer clustering for initial assignment
  const clusterLayer: number[] = [];
  const assignments = fourLayerClustering(virtualHospitals, territoryCount, ec.maxCities, ec.indexTarget, lockMap, cityAffinity, ec.maxDistanceKm, exclusiveCities, clusterLayer);

  // L0 = 一对一城市专属簇,SA 中不能往里 move/swap 任何外部医院
  const exclusiveClusterIdx = new Set<number>();
  clusterLayer.forEach((l, i) => { if (l === 0) exclusiveClusterIdx.add(i); });
  if (exclusiveClusterIdx.size > 0) {
    console.log(`[SA诊断] L0 一对一城市专属簇: ${exclusiveClusterIdx.size} 个 (索引: ${[...exclusiveClusterIdx].join(',')})`);
  }

  // Build adjacency map for SA: only allow moves between adjacent clusters
  let adjacency = buildAdjacency(assignments);

  let currentCost = calculateCost(assignments, ec, historicalMap, lockMap);
  const iterations = ec.iterations;
  const initialCost = currentCost;

  // [DIAG] 锁定医院规模
  if (lockMap) {
    const totalVHs = virtualHospitals.length;
    const lockedInscodes = lockMap.size;
    const lockedVHs = virtualHospitals.filter(vh => lockMap.has(vh.inscode)).length;
    console.log(`[SA诊断] lockMap: ${lockedInscodes} 个 inscode, 覆盖 ${lockedVHs}/${totalVHs} VHs (${(lockedVHs/totalVHs*100).toFixed(1)}%)`);
  } else {
    console.log(`[SA诊断] lockMap: 空`);
  }

  // ============================================================
  // 探测阶段：自适应估计初始温度 T0
  // 目标：T0 使初始接受率约 50%，公式 T0 = -median(positiveDelta) / ln(0.5)
  // ============================================================
  const PROBE_TARGET = 200;
  const MAX_PROBE_TRIES = 2000;
  const probeDeltas: number[] = [];

  for (let p = 0; p < MAX_PROBE_TRIES && probeDeltas.length < PROBE_TARGET; p++) {
    const mode = Math.random();
    const t1 = Math.floor(Math.random() * territoryCount);
    const neighbors = adjacency.get(t1);
    if (!neighbors || neighbors.size === 0) continue;
    const neighborArr = Array.from(neighbors);
    const t2 = neighborArr[Math.floor(Math.random() * neighborArr.length)];

    // L0 保护:不能 move/swap 进 L0 专属簇,源也不能是 L0
    if (exclusiveClusterIdx.has(t1) || exclusiveClusterIdx.has(t2)) continue;

    if (mode < 0.6 && assignments[t1].length > 1) {
      const hIdx = Math.floor(Math.random() * assignments[t1].length);
      const h = assignments[t1][hIdx];
      if (lockMap && lockMap.has(h.inscode)) {
        const allowedSet = lockMap.get(h.inscode)!;
        if (h.portion >= 0.999) continue;
        if (!allowedSet.has(t2)) continue;
      }
      if (h.portion < 0.999 && assignments[t2].some(vh => vh.originalId === h.originalId)) continue;
      if (h.city && ec.maxCities > 0) {
        const targetCities = new Set(assignments[t2].map(vh => vh.city).filter(Boolean));
        if (!targetCities.has(h.city) && targetCities.size >= ec.maxCities) continue;
      }
      assignments[t1].splice(hIdx, 1);
      assignments[t2].push(h);
      const newCost = calculateCost(assignments, ec, historicalMap, lockMap);
      probeDeltas.push(newCost - currentCost);
      assignments[t2].pop();
      assignments[t1].splice(hIdx, 0, h);
    } else if (mode >= 0.6 && assignments[t1].length > 0 && assignments[t2].length > 0) {
      const idx1 = Math.floor(Math.random() * assignments[t1].length);
      const idx2 = Math.floor(Math.random() * assignments[t2].length);
      const h1 = assignments[t1][idx1];
      const h2 = assignments[t2][idx2];
      if (lockMap) {
        if (lockMap.has(h1.inscode)) {
          const allowed1 = lockMap.get(h1.inscode)!;
          if (h1.portion >= 0.999) continue;
          if (!allowed1.has(t2)) continue;
        }
        if (lockMap.has(h2.inscode)) {
          const allowed2 = lockMap.get(h2.inscode)!;
          if (h2.portion >= 0.999) continue;
          if (!allowed2.has(t1)) continue;
        }
      }
      if (h1.portion < 0.999 && assignments[t2].some(vh => vh !== h2 && vh.originalId === h1.originalId)) continue;
      if (h2.portion < 0.999 && assignments[t1].some(vh => vh !== h1 && vh.originalId === h2.originalId)) continue;
      if (ec.maxCities > 0) {
        if (h1.city && h1.city !== h2.city) {
          const t2Cities = new Set(assignments[t2].filter(vh => vh !== h2).map(vh => vh.city).filter(Boolean));
          if (!t2Cities.has(h1.city) && t2Cities.size >= ec.maxCities) continue;
        }
        if (h2.city && h2.city !== h1.city) {
          const t1Cities = new Set(assignments[t1].filter(vh => vh !== h1).map(vh => vh.city).filter(Boolean));
          if (!t1Cities.has(h2.city) && t1Cities.size >= ec.maxCities) continue;
        }
      }
      assignments[t1][idx1] = h2;
      assignments[t2][idx2] = h1;
      const newCost = calculateCost(assignments, ec, historicalMap, lockMap);
      probeDeltas.push(newCost - currentCost);
      assignments[t1][idx1] = h1;
      assignments[t2][idx2] = h2;
    }
  }

  const positiveDeltas = probeDeltas.filter(d => d > 0).sort((a, b) => a - b);
  const T0 = positiveDeltas.length > 0
    ? -positiveDeltas[Math.floor(positiveDeltas.length / 2)] / Math.log(0.5)
    : Math.max(1, Math.abs(probeDeltas[0] || 1));
  const Tmin = T0 * 1e-4;
  const alpha = Math.pow(Tmin / T0, 1 / iterations);
  console.log(`[SA] 探测 ${probeDeltas.length} 次（正delta ${positiveDeltas.length}）→ T₀=${T0.toFixed(2)}, Tmin=${Tmin.toFixed(4)}, α=${alpha.toFixed(8)}`);

  // ============================================================
  // 阶段划分：前 80% 跑 SA，后 20% 从 best 起跑做贪心抛光
  // ============================================================
  const saIterations = Math.floor(iterations * 0.8);

  // 维护全局最优解
  let bestAssignments: VirtualHospital[][] = assignments.map(c => c.slice());
  let bestCost = currentCost;

  // ============================================================
  // [DIAG] 分桶统计（每 50k 一桶）
  // ============================================================
  const BUCKET = 50000;
  const numBuckets = Math.ceil(iterations / BUCKET);
  const diag = {
    attempted: new Array(numBuckets).fill(0),
    acceptedImprove: new Array(numBuckets).fill(0), // delta < 0 接受
    acceptedWorse: new Array(numBuckets).fill(0),   // delta >= 0 概率接受
    rejected: new Array(numBuckets).fill(0),
    costAtBucket: new Array(numBuckets).fill(0),
    bestAtBucket: new Array(numBuckets).fill(0),
    tempAtBucket: new Array(numBuckets).fill(0),
    skipNoNeighbor: 0,
    skipL0Cluster: 0,
    skipMoveSourceTooSmall: 0,
    skipMoveLocked: 0,
    skipMoveSplitDuplicate: 0,
    skipMoveCityLimit: 0,
    skipSwapEmpty: 0,
    skipSwapLocked: 0,
    skipSwapSplitDuplicate: 0,
    skipSwapCityLimit: 0,
  };

  // ============================================================
  // 主循环：前 saIterations 步 Metropolis + 指数冷却，后续切贪心抛光
  // ============================================================
  for (let step = 0; step < iterations; step++) {
    const bucket = Math.min(Math.floor(step / BUCKET), numBuckets - 1);
    const inSAPhase = step < saIterations;
    const T = inSAPhase ? T0 * Math.pow(alpha, step) : 0;

    // 进入贪心抛光阶段：从 bestAssignments 起跑，重建邻接图
    if (step === saIterations) {
      assignments.length = 0;
      for (const c of bestAssignments) assignments.push(c.slice());
      currentCost = bestCost;
      adjacency = buildAdjacency(assignments);
      console.log(`[SA] step=${step}: 进入贪心抛光阶段，从 best=${bestCost.toFixed(0)} 起跑`);
    }

    // 每 50k 步重建邻接图（贪心阶段也照常），并记录上一桶末 cost / best / T
    if (step > 0 && step % BUCKET === 0 && step !== saIterations) {
      adjacency = buildAdjacency(assignments);
      diag.costAtBucket[bucket - 1] = currentCost;
      diag.bestAtBucket[bucket - 1] = bestCost;
      diag.tempAtBucket[bucket - 1] = T;
    } else if (step > 0 && step % BUCKET === 0) {
      diag.costAtBucket[bucket - 1] = currentCost;
      diag.bestAtBucket[bucket - 1] = bestCost;
      diag.tempAtBucket[bucket - 1] = T;
    }

    const mode = Math.random();
    const t1 = Math.floor(Math.random() * territoryCount);
    const neighbors = adjacency.get(t1);
    if (!neighbors || neighbors.size === 0) { diag.skipNoNeighbor++; continue; }
    const neighborArr = Array.from(neighbors);
    const t2 = neighborArr[Math.floor(Math.random() * neighborArr.length)];

    // L0 保护:t1 或 t2 是一对一城市专属簇,跳过(不可写入,不可移出)
    if (exclusiveClusterIdx.has(t1) || exclusiveClusterIdx.has(t2)) { diag.skipL0Cluster++; continue; }

    if (mode < 0.6 && assignments[t1].length > 0) {
      if (assignments[t1].length <= 1) { diag.skipMoveSourceTooSmall++; continue; }

      const hIdx = Math.floor(Math.random() * assignments[t1].length);
      const h = assignments[t1][hIdx];

      if (lockMap && lockMap.has(h.inscode)) {
        const allowedSet = lockMap.get(h.inscode)!;
        if (h.portion >= 0.999) { diag.skipMoveLocked++; continue; }
        if (!allowedSet.has(t2)) { diag.skipMoveLocked++; continue; }
      }
      if (h.portion < 0.999 && assignments[t2].some(vh => vh.originalId === h.originalId)) { diag.skipMoveSplitDuplicate++; continue; }
      if (h.city && ec.maxCities > 0) {
        const targetCities = new Set(assignments[t2].map(vh => vh.city).filter(Boolean));
        if (!targetCities.has(h.city) && targetCities.size >= ec.maxCities) { diag.skipMoveCityLimit++; continue; }
      }

      assignments[t1].splice(hIdx, 1);
      assignments[t2].push(h);

      diag.attempted[bucket]++;
      const newCost = calculateCost(assignments, ec, historicalMap, lockMap);
      const delta = newCost - currentCost;
      const accept = delta < 0 || (inSAPhase && Math.random() < Math.exp(-delta / T));
      if (accept) {
        currentCost = newCost;
        if (delta < 0) diag.acceptedImprove[bucket]++;
        else diag.acceptedWorse[bucket]++;
        if (currentCost < bestCost) {
          bestCost = currentCost;
          bestAssignments = assignments.map(c => c.slice());
        }
      } else {
        assignments[t2].pop();
        assignments[t1].splice(hIdx, 0, h);
        diag.rejected[bucket]++;
      }
    } else if (mode >= 0.6 && assignments[t1].length > 0 && assignments[t2].length > 0) {
      const idx1 = Math.floor(Math.random() * assignments[t1].length);
      const idx2 = Math.floor(Math.random() * assignments[t2].length);

      const h1 = assignments[t1][idx1];
      const h2 = assignments[t2][idx2];

      if (lockMap) {
        if (lockMap.has(h1.inscode)) {
          const allowed1 = lockMap.get(h1.inscode)!;
          if (h1.portion >= 0.999) { diag.skipSwapLocked++; continue; }
          if (!allowed1.has(t2)) { diag.skipSwapLocked++; continue; }
        }
        if (lockMap.has(h2.inscode)) {
          const allowed2 = lockMap.get(h2.inscode)!;
          if (h2.portion >= 0.999) { diag.skipSwapLocked++; continue; }
          if (!allowed2.has(t1)) { diag.skipSwapLocked++; continue; }
        }
      }

      if (h1.portion < 0.999 && assignments[t2].some(vh => vh !== h2 && vh.originalId === h1.originalId)) { diag.skipSwapSplitDuplicate++; continue; }
      if (h2.portion < 0.999 && assignments[t1].some(vh => vh !== h1 && vh.originalId === h2.originalId)) { diag.skipSwapSplitDuplicate++; continue; }

      if (ec.maxCities > 0) {
        if (h1.city && h1.city !== h2.city) {
          const t2Cities = new Set(assignments[t2].filter(vh => vh !== h2).map(vh => vh.city).filter(Boolean));
          if (!t2Cities.has(h1.city) && t2Cities.size >= ec.maxCities) { diag.skipSwapCityLimit++; continue; }
        }
        if (h2.city && h2.city !== h1.city) {
          const t1Cities = new Set(assignments[t1].filter(vh => vh !== h1).map(vh => vh.city).filter(Boolean));
          if (!t1Cities.has(h2.city) && t1Cities.size >= ec.maxCities) { diag.skipSwapCityLimit++; continue; }
        }
      }

      assignments[t1][idx1] = h2;
      assignments[t2][idx2] = h1;

      diag.attempted[bucket]++;
      const newCost = calculateCost(assignments, ec, historicalMap, lockMap);
      const delta = newCost - currentCost;
      const accept = delta < 0 || (inSAPhase && Math.random() < Math.exp(-delta / T));
      if (accept) {
        currentCost = newCost;
        if (delta < 0) diag.acceptedImprove[bucket]++;
        else diag.acceptedWorse[bucket]++;
        if (currentCost < bestCost) {
          bestCost = currentCost;
          bestAssignments = assignments.map(c => c.slice());
        }
      } else {
        assignments[t1][idx1] = h1;
        assignments[t2][idx2] = h2;
        diag.rejected[bucket]++;
      }
    }
  }
  diag.costAtBucket[numBuckets - 1] = currentCost;
  diag.bestAtBucket[numBuckets - 1] = bestCost;
  diag.tempAtBucket[numBuckets - 1] = T0 * Math.pow(alpha, iterations);

  // [DIAG] 输出诊断报告
  const totalAttempted = diag.attempted.reduce((a, b) => a + b, 0);
  const totalAcceptedImprove = diag.acceptedImprove.reduce((a, b) => a + b, 0);
  const totalAcceptedWorse = diag.acceptedWorse.reduce((a, b) => a + b, 0);
  const totalAccepted = totalAcceptedImprove + totalAcceptedWorse;
  const totalSkipped =
    diag.skipNoNeighbor + diag.skipL0Cluster + diag.skipMoveSourceTooSmall + diag.skipMoveLocked +
    diag.skipMoveSplitDuplicate + diag.skipMoveCityLimit +
    diag.skipSwapEmpty + diag.skipSwapLocked + diag.skipSwapSplitDuplicate + diag.skipSwapCityLimit;
  console.log(`\n[SA诊断] iter=${iterations}, attempted=${totalAttempted}, accepted=${totalAccepted} (改善${totalAcceptedImprove}+劣解${totalAcceptedWorse}, ${(totalAccepted/Math.max(totalAttempted,1)*100).toFixed(2)}%), skipped=${totalSkipped} (${(totalSkipped/iterations*100).toFixed(1)}% of total)`);
  console.log(`[SA诊断] cost: 初始=${initialCost.toFixed(0)}, 最终current=${currentCost.toFixed(0)}, 最终best=${bestCost.toFixed(0)} (best Δ=${(initialCost-bestCost).toFixed(0)}, ${((initialCost-bestCost)/Math.max(initialCost,1)*100).toFixed(2)}%)`);
  console.log(`[SA诊断] 跳过分布: noNeighbor=${diag.skipNoNeighbor}, L0=${diag.skipL0Cluster}, moveTooSmall=${diag.skipMoveSourceTooSmall}, moveLocked=${diag.skipMoveLocked}, moveSplitDup=${diag.skipMoveSplitDuplicate}, moveCity=${diag.skipMoveCityLimit}, swapLocked=${diag.skipSwapLocked}, swapSplitDup=${diag.skipSwapSplitDuplicate}, swapCity=${diag.skipSwapCityLimit}`);
  console.log(`[SA诊断] 分桶（每${BUCKET}步）  尝试  改善  劣接   接受率  桶末T  桶末current  桶末best`);
  for (let b = 0; b < numBuckets; b++) {
    const att = diag.attempted[b];
    const ai = diag.acceptedImprove[b];
    const aw = diag.acceptedWorse[b];
    const rate = att > 0 ? ((ai+aw)/att*100).toFixed(2) : '0.00';
    console.log(`            桶${String(b+1).padStart(2)}: ${String(att).padStart(7)} ${String(ai).padStart(5)} ${String(aw).padStart(5)} ${rate.padStart(6)}%  ${diag.tempAtBucket[b].toFixed(2).padStart(8)} ${diag.costAtBucket[b].toFixed(0).padStart(11)} ${diag.bestAtBucket[b].toFixed(0).padStart(10)}`);
  }

  return bestAssignments;
}

// ============================================================
// 5. Build result from assignments
// ============================================================

function buildResult(
  assignments: VirtualHospital[][],
  hospitals: Hospital[],
  territories: Territory[],
  ec: EffectiveConstraints,
  productGroup?: string
): OptimizationResult {
  const hospitalMap = new Map(hospitals.map((h) => [h.id, h]));

  // Aggregate split portions: originalId -> { territoryIdx -> totalPortion }
  const splitMap = new Map<string, Map<number, number>>();
  for (let tIdx = 0; tIdx < assignments.length; tIdx++) {
    for (const vh of assignments[tIdx]) {
      if (!splitMap.has(vh.originalId)) splitMap.set(vh.originalId, new Map());
      const tMap = splitMap.get(vh.originalId)!;
      tMap.set(tIdx, (tMap.get(tIdx) || 0) + vh.portion);
    }
  }

  // Build assignments list
  const allAssignments: Assignment[] = [];
  const territoryResults: TerritoryResult[] = territories.map((t, tIdx) => {
    const hospSet = new Map<string, { hospital: Hospital; ratio: number }>();

    for (const vh of assignments[tIdx]) {
      const hospital = hospitalMap.get(vh.originalId);
      if (!hospital) continue;

      const totalPortionInThisTerritory = splitMap.get(vh.originalId)?.get(tIdx) || vh.portion;

      if (!hospSet.has(vh.originalId)) {
        hospSet.set(vh.originalId, { hospital, ratio: totalPortionInThisTerritory });
      }
    }

    const hospList: Hospital[] = [];
    const assignList: Assignment[] = [];

    for (const [hId, { hospital, ratio }] of hospSet) {
      hospList.push(hospital);
      const isSplit = ratio < 0.999;
      const assignment: Assignment = {
        hospitalId: hId,
        hospitalName: hospital.insname,
        territoryId: t.id,
        territoryName: t.trtyCode,
        productGroup: productGroup || hospital.productGroup || '',
        splitRatio: isSplit ? ratio : undefined,
      };
      assignList.push(assignment);
      allAssignments.push(assignment);
    }

    const cities = new Set(hospList.map((h) => h.city).filter(Boolean));

    return {
      territory: t,
      hospitals: hospList,
      assignments: assignList,
      totalIndex: hospList.reduce((s, h) => {
        const ratio = hospSet.get(h.id)?.ratio ?? 1;
        return s + h.index * ratio;
      }, 0),
      totalSales: hospList.reduce((s, h) => {
        const ratio = hospSet.get(h.id)?.ratio ?? 1;
        return s + h.sales * ratio;
      }, 0),
      totalPotential: hospList.reduce((s, h) => {
        const ratio = hospSet.get(h.id)?.ratio ?? 1;
        return s + h.potential * ratio;
      }, 0),
      hospitalCount: hospList.length,
      cityCount: cities.size,
    };
  });

  // Evaluate constraints
  const { score, satisfied, details } = evaluateResult(territoryResults, ec, hospitals);

  return {
    assignments: allAssignments,
    territoryResults,
    score,
    constraintsSatisfied: satisfied,
    constraintsTotal: ec.all.length,
    details,
    productGroup: productGroup || '',
  };
}

// ============================================================
// 6. Constraint evaluation
// ============================================================

function evaluateResult(
  results: TerritoryResult[],
  ec: EffectiveConstraints,
  hospitals: Hospital[]
): { score: number; satisfied: number; details: string[] } {
  let satisfied = 0;
  const details: string[] = [];

  for (const c of ec.all) {
    let ok = false;

    switch (c.type) {
      case 'index_range': {
        const bad = results.filter((r) => r.totalIndex < ec.indexMin || r.totalIndex > ec.indexMax);
        ok = bad.length === 0;
        if (ok) {
          details.push(`${c.description}: 满足`);
        } else {
          const info = bad.map((r) => `${r.territory.trtyCode}=${r.totalIndex.toFixed(1)}`).join(', ');
          details.push(`${c.description}: 未满足 (${info})`);
        }
        break;
      }
      case 'capacity': {
        const max = Number(c.value) || ec.maxHospitals;
        const bad = results.filter((r) => r.hospitalCount > max);
        ok = bad.length === 0;
        details.push(ok
          ? `${c.description}: 满足`
          : `${c.description}: 未满足 (${bad.map((r) => `${r.territory.trtyCode}=${r.hospitalCount}家`).join(', ')})`
        );
        break;
      }
      case 'city_limit': {
        const max = Number(c.value) || ec.maxCities;
        const bad = results.filter((r) => r.cityCount > max);
        ok = bad.length === 0;
        details.push(ok
          ? `${c.description}: 满足`
          : `${c.description}: 未满足 (${bad.map((r) => `${r.territory.trtyCode}=${r.cityCount}个城市`).join(', ')})`
        );
        break;
      }
      case 'geographic_distance': {
        const maxKm = Number(c.value) || ec.maxDistanceKm;
        const violating: string[] = [];
        let worstDist = 0;
        let worstT = '';
        for (const r of results) {
          const hs = r.hospitals.filter((h) => h.latitude && h.longitude);
          let exceeds = false;
          for (let i = 0; i < hs.length && !exceeds; i++) {
            for (let j = i + 1; j < hs.length; j++) {
              const d = haversineKm(hs[i].longitude, hs[i].latitude, hs[j].longitude, hs[j].latitude);
              if (d > maxKm) {
                exceeds = true;
                if (d > worstDist) { worstDist = d; worstT = r.territory.trtyCode; }
                break;
              }
            }
          }
          if (exceeds) violating.push(r.territory.trtyCode);
        }
        ok = violating.length === 0;
        details.push(ok
          ? `${c.description}: 满足`
          : `${c.description}: 未满足 (${violating.length}个辖区超过${maxKm}km，最远${worstDist.toFixed(0)}km在${worstT})`
        );
        break;
      }
      case 'split_count': {
        const splitThreshold = c.value2 ?? 1500;
        const hospCount = new Map<string, number>();
        for (const r of results) {
          for (const a of r.assignments) {
            hospCount.set(a.hospitalId, (hospCount.get(a.hospitalId) || 0) + 1);
          }
        }
        const hospIndexMap = new Map(hospitals.map((h) => [h.id, h.index]));
        const violations: string[] = [];
        for (const [hId, count] of hospCount) {
          const hIndex = hospIndexMap.get(hId) || 0;
          if (hIndex < splitThreshold && count > 1) violations.push(hId);
          else if (hIndex >= splitThreshold && count > Math.floor(hIndex / 1000) + 1) violations.push(hId);
        }
        ok = violations.length === 0;
        details.push(ok
          ? `${c.description}: 满足`
          : `${c.description}: 未满足 (${violations.length}家医院AB岗拆分条件不符合规则)`
        );
        break;
      }
      case 'split_ratio_sum': {
        const ratioMap = new Map<string, number>();
        for (const r of results) {
          for (const a of r.assignments) {
            const ratio = a.splitRatio ?? 1.0;
            ratioMap.set(a.hospitalId, (ratioMap.get(a.hospitalId) || 0) + ratio);
          }
        }
        const bad = Array.from(ratioMap.entries()).filter(([, sum]) => Math.abs(sum - 1.0) > 0.05);
        ok = bad.length === 0;
        details.push(ok
          ? `${c.description}: 满足`
          : `${c.description}: 未满足 (${bad.length}家医院比例加和不为100%)`
        );
        break;
      }
      case 'balance': {
        const avg = results.reduce((s, r) => s + r.hospitalCount, 0) / results.length;
        const maxDiff = Math.max(...results.map((r) => Math.abs(r.hospitalCount - avg)));
        ok = maxDiff <= avg * 0.5;
        details.push(`${c.description}: ${ok ? '满足' : '未满足'} (最大偏差${maxDiff.toFixed(1)})`);
        break;
      }
      case 'sales': {
        const vals = results.map((r) => r.totalSales);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const maxDiff = Math.max(...vals.map((v) => Math.abs(v - avg)));
        const ratio = avg > 0 ? maxDiff / avg : 0;
        ok = ratio < 0.3;
        details.push(`${c.description}: ${ok ? '满足' : '未满足'} (偏差${(ratio * 100).toFixed(1)}%)`);
        break;
      }
      case 'potential': {
        const vals = results.map((r) => r.totalPotential);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const maxDiff = Math.max(...vals.map((v) => Math.abs(v - avg)));
        const ratio = avg > 0 ? maxDiff / avg : 0;
        ok = ratio < 0.3;
        details.push(`${c.description}: ${ok ? '满足' : '未满足'} (偏差${(ratio * 100).toFixed(1)}%)`);
        break;
      }
      case 'historical_stability': {
        // Evaluated at result level via changeRate, always mark as considered
        ok = true;
        details.push(`${c.description}: 已应用（阈值${c.threshold ?? 200}）`);
        break;
      }
      case 'district_concentration': {
        const districtCounts = results.map((r) => {
          const ds = new Set(r.hospitals.map((h) => h.district).filter(Boolean));
          return { trty: r.territory.trtyCode, count: ds.size };
        });
        const avgDistricts = districtCounts.reduce((s, d) => s + d.count, 0) / districtCounts.length;
        ok = true; // soft constraint, always "considered"
        details.push(`${c.description}: 已应用（平均${avgDistricts.toFixed(1)}个区县/辖区）`);
        break;
      }
      default: {
        ok = true;
        details.push(`${c.description}: 已考虑`);
      }
    }

    if (ok) satisfied++;
  }

  const score = ec.all.length > 0 ? (satisfied / ec.all.length) * 100 : 100;
  return { score, satisfied, details };
}

// ============================================================
// Public API — single province (kept for backward compat)
// ============================================================

export function optimize(
  hospitals: Hospital[],
  territories: Territory[],
  constraints: Constraint[],
  historicalAssignments?: import('@/types').HistoricalAssignment[]
): OptimizationResult {
  const ec = buildEffectiveConstraints(constraints);
  const virtualHospitals = preprocessHospitals(hospitals, ec.indexTarget);

  // Build historical map: inscode -> set of territory indices
  let historicalMap: HistoricalMap | undefined;
  if (historicalAssignments && historicalAssignments.length > 0 && ec.hasHistorical && ec.historicalThreshold > 0) {
    historicalMap = new Map();
    const trtyToIdx = new Map(territories.map((t, i) => [t.trtyCode, i]));
    for (const ha of historicalAssignments) {
      const tIdx = trtyToIdx.get(ha.trtyCode);
      if (tIdx !== undefined) {
        if (!historicalMap.has(ha.inscode)) historicalMap.set(ha.inscode, new Set());
        historicalMap.get(ha.inscode)!.add(tIdx);
      }
    }
  }

  const assignments = runOptimization(virtualHospitals, territories.length, ec, historicalMap);
  const result = buildResult(assignments, hospitals, territories, ec, '');

  // Calculate change rate
  if (historicalAssignments && historicalAssignments.length > 0) {
    result.changeRate = computeChangeRate(result.assignments, hospitals, historicalAssignments);
  }

  return result;
}

// ============================================================
// Public API — multi-province loop
// ============================================================

export function optimizeByProvince(
  hospitals: Hospital[],
  territories: Territory[],
  constraints: Constraint[],
  onProgress?: (current: number, total: number, province: string) => void,
  historicalAssignments?: import('@/types').HistoricalAssignment[],
  lockAssignments?: LockAssignment[],
  regionConstraints?: RegionConstraintParams[],
  algorithmMode?: AlgorithmMode
): OptimizationResult {
  // Determine product groups
  const productGroups = Array.from(new Set(
    territories.map((t) => t.productGroup).filter(Boolean)
  )).sort();

  const mode = algorithmMode || 'option1';

  // If no product group dimension, treat as single group
  if (productGroups.length === 0) {
    return optimizeSingleGroup(hospitals, territories, constraints, onProgress, historicalAssignments, lockAssignments, regionConstraints, '', mode);
  }

  // Multi-product-group loop
  const allResults: OptimizationResult[] = [];
  let progressOffset = 0;

  // Count total provinces across all product groups for progress
  let totalSteps = 0;
  for (const pg of productGroups) {
    const pgTerritories = territories.filter((t) => t.productGroup === pg);
    const provSet = new Set(pgTerritories.map((t) => t.province).filter(Boolean));
    totalSteps += Math.max(provSet.size, 1);
  }

  for (const pg of productGroups) {
    const pgHospitals = hospitals.filter((h) => h.productGroup === pg);
    const pgTerritories = territories.filter((t) => t.productGroup === pg);
    const pgHistorical = historicalAssignments?.filter((ha) => ha.productGroup === pg);
    const pgLocks = lockAssignments?.filter((la) => la.productGroup === pg);
    const pgRegionConstraints = regionConstraints?.filter((rc) => rc.productGroup === pg);

    if (pgHospitals.length === 0 || pgTerritories.length === 0) continue;

    const pgResult = optimizeSingleGroup(
      pgHospitals, pgTerritories, constraints,
      (current, total, province) => {
        onProgress?.(progressOffset + current, totalSteps, `[${pg}] ${province}`);
      },
      pgHistorical, pgLocks, pgRegionConstraints, pg, mode
    );

    const provSet = new Set(pgTerritories.map((t) => t.province).filter(Boolean));
    progressOffset += Math.max(provSet.size, 1);

    allResults.push(pgResult);
  }

  // Merge results across product groups
  return mergeResults(allResults, hospitals, historicalAssignments);
}

function optimizeSingleGroup(
  hospitals: Hospital[],
  territories: Territory[],
  constraints: Constraint[],
  onProgress?: (current: number, total: number, province: string) => void,
  historicalAssignments?: import('@/types').HistoricalAssignment[],
  lockAssignments?: LockAssignment[],
  regionConstraints?: RegionConstraintParams[],
  productGroup?: string,
  algorithmMode?: AlgorithmMode
): OptimizationResult {
  const mode = algorithmMode || 'option1';
  // Group hospitals and territories by province
  const provinceSet = new Set<string>();
  for (const t of territories) {
    if (t.province) provinceSet.add(t.province);
  }
  const provinces = Array.from(provinceSet).sort();

  // If no province info or only one province, fall back to single optimize
  if (provinces.length <= 1) {
    onProgress?.(1, 1, provinces[0] || '全部');
    let ec = buildEffectiveConstraints(constraints);

    // Apply region-specific constraints for single-province case
    const region = territories[0]?.region || '';
    if (region && regionConstraints) {
      const regionParams = regionConstraints.find(
        (rc) => rc.region === region && (!productGroup || rc.productGroup === productGroup)
      );
      if (regionParams) {
        const rIndexMin = regionParams.indexMin;
        const rIndexMax = regionParams.indexMax;
        ec = {
          ...ec,
          indexMin: rIndexMin,
          indexMax: rIndexMax,
          indexTarget: (rIndexMin + rIndexMax) / 2,
          maxHospitals: regionParams.capacityMax,
          maxCities: regionParams.cityLimitMax,
          maxDistanceKm: regionParams.maxDistanceKm,
          indexThreshold: regionParams.indexThreshold,
          capacityThreshold: regionParams.capacityThreshold,
          cityThreshold: regionParams.cityThreshold,
          distanceThreshold: regionParams.distanceThreshold,
          historicalThreshold: regionParams.historicalThreshold,
          districtThreshold: regionParams.districtThreshold ?? 1,
        };
      }
    }

    const virtualHospitals = preprocessHospitals(hospitals, ec.indexTarget);

    let historicalMap: HistoricalMap | undefined;
    // option2: don't use historical penalty in SA — history is handled by post-matching
    if (mode === 'option1' && historicalAssignments && historicalAssignments.length > 0 && ec.hasHistorical && ec.historicalThreshold > 0) {
      historicalMap = new Map();
      const trtyToIdx = new Map(territories.map((t, i) => [t.trtyCode, i]));
      for (const ha of historicalAssignments) {
        const tIdx = trtyToIdx.get(ha.trtyCode);
        if (tIdx !== undefined) {
          if (!historicalMap.has(ha.inscode)) historicalMap.set(ha.inscode, new Set());
          historicalMap.get(ha.inscode)!.add(tIdx);
        }
      }
    }

    let lockMap: LockMap | undefined;
    if (lockAssignments && lockAssignments.length > 0) {
      lockMap = buildLockMap(lockAssignments, territories);
    }

    // 构建城市亲和关系和一对一城市锁定
    const cityAffinityMap = buildCityAffinity(hospitals, historicalAssignments);
    const exclusiveCitiesSet = buildExclusiveCities(hospitals, historicalAssignments);

    // 一对一城市通过 lockMap 锁定到历史辖区
    if (exclusiveCitiesSet.size > 0 && historicalAssignments && historicalAssignments.length > 0) {
      if (!lockMap) lockMap = new Map();
      const trtyToIdx = new Map(territories.map((t, i) => [t.trtyCode, i]));
      const hospitalCityMap = new Map(hospitals.map(h => [h.inscode, h.city]));
      for (const ha of historicalAssignments) {
        const city = hospitalCityMap.get(ha.inscode);
        if (!city || !exclusiveCitiesSet.has(city)) continue;
        const tIdx = trtyToIdx.get(ha.trtyCode);
        if (tIdx === undefined) continue;
        if (!lockMap.has(ha.inscode)) lockMap.set(ha.inscode, new Set());
        lockMap.get(ha.inscode)!.add(tIdx);
      }
    }

    // option2: disable historical penalty so SA optimizes purely for balance
    const saEc = mode === 'option2' ? { ...ec, hasHistorical: false, historicalThreshold: 0 } : ec;
    let assignments = runOptimization(virtualHospitals, territories.length, saEc, historicalMap, lockMap, cityAffinityMap, exclusiveCitiesSet);

    // 所有模式都需要 Hungarian 匹配：cluster→territory 映射
    if (historicalAssignments && historicalAssignments.length > 0) {
      const provInscodes = new Set(hospitals.map((h) => h.inscode));
      const provHistorical = historicalAssignments.filter((ha) => provInscodes.has(ha.inscode));
      if (provHistorical.length > 0) {
        assignments = matchClustersToHistory(assignments, territories, provHistorical, hospitals, lockMap);
      }
    }

    const result = buildResult(assignments, hospitals, territories, ec, productGroup);

    if (historicalAssignments && historicalAssignments.length > 0) {
      result.changeRate = computeChangeRate(result.assignments, hospitals, historicalAssignments);
    }
    return result;
  }

  const baseEc = buildEffectiveConstraints(constraints);
  const allAssignments: Assignment[] = [];
  const allTerritoryResults: TerritoryResult[] = [];
  const provinceDetails: import('@/types').ProvinceConstraintDetail[] = [];
  let totalSatisfied = 0;
  let skippedProvinces = 0;

  const constraintSatisfiedCount = new Map<string, number>();
  const constraintTotalCount = new Map<string, number>();
  for (const c of baseEc.all) {
    constraintSatisfiedCount.set(c.description, 0);
    constraintTotalCount.set(c.description, 0);
  }

  for (let i = 0; i < provinces.length; i++) {
    const province = provinces[i];
    onProgress?.(i + 1, provinces.length, province);

    const provHospitals = hospitals.filter((h) => h.province === province);
    const provTerritories = territories.filter((t) => t.province === province);

    if (provHospitals.length === 0 || provTerritories.length === 0) {
      skippedProvinces++;
      continue;
    }

    // Apply region-specific constraints if available
    const region = provTerritories[0]?.region || '';
    const regionParams = regionConstraints?.find(
      (rc) => rc.region === region && (!productGroup || rc.productGroup === productGroup)
    );

    let ec = baseEc;
    if (regionParams) {
      const rIndexMin = regionParams.indexMin;
      const rIndexMax = regionParams.indexMax;
      ec = {
        ...baseEc,
        indexMin: rIndexMin,
        indexMax: rIndexMax,
        indexTarget: (rIndexMin + rIndexMax) / 2,
        maxHospitals: regionParams.capacityMax,
        maxCities: regionParams.cityLimitMax,
        maxDistanceKm: regionParams.maxDistanceKm,
        indexThreshold: regionParams.indexThreshold,
        capacityThreshold: regionParams.capacityThreshold,
        cityThreshold: regionParams.cityThreshold,
        distanceThreshold: regionParams.distanceThreshold,
        historicalThreshold: regionParams.historicalThreshold,
        districtThreshold: regionParams.districtThreshold ?? 1,
      };
    }

    // Build per-province historical map (option1 only — option2 skips history in SA)
    let provHistMap: HistoricalMap | undefined;
    if (mode === 'option1' && historicalAssignments && historicalAssignments.length > 0 && ec.hasHistorical && ec.historicalThreshold > 0) {
      provHistMap = new Map();
      const trtyToIdx = new Map(provTerritories.map((t, i) => [t.trtyCode, i]));
      const provInscodes = new Set(provHospitals.map((h) => h.inscode));
      for (const ha of historicalAssignments) {
        if (!provInscodes.has(ha.inscode)) continue;
        const tIdx = trtyToIdx.get(ha.trtyCode);
        if (tIdx !== undefined) {
          if (!provHistMap.has(ha.inscode)) provHistMap.set(ha.inscode, new Set());
          provHistMap.get(ha.inscode)!.add(tIdx);
        }
      }
    }

    // Build per-province lock map
    let provLockMap: LockMap | undefined;
    if (lockAssignments && lockAssignments.length > 0) {
      const provInscodes = new Set(provHospitals.map((h) => h.inscode));
      const provLocks = lockAssignments.filter((la) => provInscodes.has(la.inscode));
      if (provLocks.length > 0) {
        provLockMap = buildLockMap(provLocks, provTerritories);
      }
    }

    const virtualHospitals = preprocessHospitals(provHospitals, ec.indexTarget);

    // 构建省级城市亲和关系和一对一城市锁定
    const provInscodes2 = new Set(provHospitals.map((h) => h.inscode));
    const provHistForAffinity = historicalAssignments?.filter((ha) => provInscodes2.has(ha.inscode));
    const provCityAffinity = buildCityAffinity(provHospitals, provHistForAffinity);
    const provExclusiveCities = buildExclusiveCities(provHospitals, provHistForAffinity);

    // 一对一城市通过 lockMap 锁定到历史辖区
    if (provExclusiveCities.size > 0 && provHistForAffinity && provHistForAffinity.length > 0) {
      if (!provLockMap) provLockMap = new Map();
      const trtyToIdx = new Map(provTerritories.map((t, i) => [t.trtyCode, i]));
      const hospitalCityMap = new Map(provHospitals.map(h => [h.inscode, h.city]));
      for (const ha of provHistForAffinity) {
        const city = hospitalCityMap.get(ha.inscode);
        if (!city || !provExclusiveCities.has(city)) continue;
        const tIdx = trtyToIdx.get(ha.trtyCode);
        if (tIdx === undefined) continue;
        if (!provLockMap.has(ha.inscode)) provLockMap.set(ha.inscode, new Set());
        provLockMap.get(ha.inscode)!.add(tIdx);
      }
    }

    // option2: disable historical penalty so SA optimizes purely for balance
    const saEc = mode === 'option2' ? { ...ec, hasHistorical: false, historicalThreshold: 0 } : ec;
    let assignments = runOptimization(virtualHospitals, provTerritories.length, saEc, provHistMap, provLockMap, provCityAffinity, provExclusiveCities);

    // 所有模式都需要 Hungarian 匹配：cluster→territory 映射
    if (historicalAssignments && historicalAssignments.length > 0) {
      const provInscodes = new Set(provHospitals.map((h) => h.inscode));
      const provHistorical = historicalAssignments.filter((ha) => provInscodes.has(ha.inscode));
      if (provHistorical.length > 0) {
        assignments = matchClustersToHistory(assignments, provTerritories, provHistorical, provHospitals, provLockMap);
      }
    }

    const provResult = buildResult(assignments, provHospitals, provTerritories, ec, productGroup);

    allAssignments.push(...provResult.assignments);
    allTerritoryResults.push(...provResult.territoryResults);
    totalSatisfied += provResult.constraintsSatisfied;

    for (const d of provResult.details) {
      const isSatisfied = d.includes('满足') && !d.includes('未满足');
      const colonIdx = d.indexOf(':');
      const constraintName = colonIdx > 0 ? d.substring(0, colonIdx).trim() : d;
      const detailText = colonIdx > 0 ? d.substring(colonIdx + 1).trim() : '';

      provinceDetails.push({
        province,
        constraint: constraintName,
        satisfied: isSatisfied,
        detail: detailText,
      });

      constraintTotalCount.set(constraintName, (constraintTotalCount.get(constraintName) || 0) + 1);
      if (isSatisfied) {
        constraintSatisfiedCount.set(constraintName, (constraintSatisfiedCount.get(constraintName) || 0) + 1);
      }
    }
  }

  const summaryDetails: string[] = [];
  const activeProvinces = provinces.length - skippedProvinces;
  summaryDetails.push(`共 ${activeProvinces} 个省份参与计算，${allTerritoryResults.length} 个辖区，${allAssignments.length} 条分配`);

  for (const [name, total] of constraintTotalCount) {
    const satisfied = constraintSatisfiedCount.get(name) || 0;
    if (total === 0) continue;
    if (satisfied === total) {
      summaryDetails.push(`${name}: 全部满足（${satisfied}/${total}个省份）`);
    } else {
      summaryDetails.push(`${name}: ${satisfied}/${total}个省份满足`);
    }
  }

  const assignedProvinces = new Set(provinces);
  const orphanHospitals = hospitals.filter((h) => !assignedProvinces.has(h.province));
  if (orphanHospitals.length > 0) {
    summaryDetails.push(`${orphanHospitals.length}家医院的省份未匹配到任何辖区省份`);
  }
  if (skippedProvinces > 0) {
    summaryDetails.push(`${skippedProvinces}个省份因数据不完整被跳过`);
  }

  const avgScore = activeProvinces > 0 && baseEc.all.length > 0
    ? (totalSatisfied / (activeProvinces * baseEc.all.length)) * 100
    : 100;

  const finalResult: OptimizationResult = {
    assignments: allAssignments,
    territoryResults: allTerritoryResults,
    score: avgScore,
    constraintsSatisfied: totalSatisfied,
    constraintsTotal: baseEc.all.length * activeProvinces,
    details: summaryDetails,
    provinceDetails,
    productGroup: productGroup || '',
  };

  if (historicalAssignments && historicalAssignments.length > 0) {
    finalResult.changeRate = computeChangeRate(finalResult.assignments, hospitals, historicalAssignments);
  }

  return finalResult;
}

// ============================================================
// Hungarian algorithm for maximum weight bipartite matching
// Used by option2 to match anonymous clusters to historical territory IDs
// ============================================================

// Solves the assignment problem: maximize total weight in an N×M cost matrix
// Returns an array where result[i] = j means row i is matched to column j (-1 if unmatched)
function hungarianMaxWeight(weights: number[][]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const m = weights[0].length;

  // Pad to square matrix (use max(n,m))
  const sz = Math.max(n, m);
  // Convert to minimization: negate weights
  const maxW = Math.max(...weights.flat(), 0);
  const cost: number[][] = Array.from({ length: sz }, (_, i) =>
    Array.from({ length: sz }, (_, j) =>
      i < n && j < m ? maxW - weights[i][j] : maxW
    )
  );

  // Kuhn-Munkres (Hungarian) algorithm for square matrix
  const u = new Float64Array(sz + 1); // row potentials
  const v = new Float64Array(sz + 1); // col potentials
  const p = new Int32Array(sz + 1);   // col -> row matching
  const way = new Int32Array(sz + 1); // augmenting path

  for (let i = 1; i <= sz; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(sz + 1).fill(Infinity);
    const used = new Uint8Array(sz + 1);

    do {
      used[j0] = 1;
      let i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;

      for (let j = 1; j <= sz; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= sz; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    // Augment path
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  // Extract result: row -> col mapping
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= sz; j++) {
    if (p[j] > 0 && p[j] <= n && j <= m) {
      result[p[j] - 1] = j - 1;
    }
  }

  return result;
}

// Phase 2 of option2: match anonymous clusters to historical territory IDs
// Uses three-level weighted matching: hospital > district > city
// Large hospitals (high index) dominate via hospital-level weight;
// small hospitals are matched primarily by geographic proximity (district/city).
function matchClustersToHistory(
  assignments: VirtualHospital[][],
  territories: Territory[],
  historicalAssignments: import('@/types').HistoricalAssignment[],
  hospitals: Hospital[],
  lockMap?: LockMap
): VirtualHospital[][] {
  const n = assignments.length; // = territory count
  const trtyToIdx = new Map(territories.map((t, i) => [t.trtyCode, i]));

  // Build hospital master lookup: inscode -> { district, city }
  const hospMaster = new Map<string, { district: string; city: string }>();
  for (const h of hospitals) {
    hospMaster.set(h.inscode.toUpperCase(), { district: h.district || '', city: h.city || '' });
  }

  // Build historical territory profiles: trtyIdx -> { inscodes, districts, cities }
  // Also track per-inscode portion for weighted matching of split hospitals
  const histInscodes: Set<string>[] = Array.from({ length: n }, () => new Set());
  const histDistricts: Set<string>[] = Array.from({ length: n }, () => new Set());
  const histCities: Set<string>[] = Array.from({ length: n }, () => new Set());
  // histPortions[tIdx][inscode] = historical portion (0~1) for that territory
  const histPortions: Map<string, number>[] = Array.from({ length: n }, () => new Map());

  for (const ha of historicalAssignments) {
    const tIdx = trtyToIdx.get(ha.trtyCode);
    if (tIdx === undefined || tIdx >= n) continue;
    const key = ha.inscode.toUpperCase();
    histInscodes[tIdx].add(key);
    if (ha.portion !== undefined) {
      histPortions[tIdx].set(key, ha.portion);
    }
    const master = hospMaster.get(key);
    if (master) {
      if (master.district) histDistricts[tIdx].add(master.district);
      if (master.city) histCities[tIdx].add(master.city);
    }
  }

  // For split hospitals with historical portions, determine which territories
  // to prioritize: keep only the top-N by portion (N = number of split portions)
  // Build a set of (inscode, tIdx) pairs to exclude from matching
  const splitExclusions = new Set<string>(); // "inscode|tIdx"
  {
    // Group historical entries by inscode
    const histByInscode = new Map<string, { tIdx: number; portion: number }[]>();
    for (const ha of historicalAssignments) {
      const tIdx = trtyToIdx.get(ha.trtyCode);
      if (tIdx === undefined || tIdx >= n) continue;
      const key = ha.inscode.toUpperCase();
      if (!histByInscode.has(key)) histByInscode.set(key, []);
      histByInscode.get(key)!.push({ tIdx, portion: ha.portion ?? 1 });
    }

    // For each split hospital, if historical rep count > split count, exclude low-portion reps
    for (const [inscode, entries] of histByInscode) {
      if (entries.length <= 1) continue;
      // Find how many portions this hospital is split into
      const vhs = assignments.flat().filter(v => v.inscode.toUpperCase() === inscode && v.portion < 0.999);
      if (vhs.length === 0) continue; // not split
      const splitCount = vhs.length;
      if (entries.length <= splitCount) continue; // enough slots for all historical reps

      // Sort by portion descending, exclude the ones beyond splitCount
      const sorted = [...entries].sort((a, b) => b.portion - a.portion);
      for (let i = splitCount; i < sorted.length; i++) {
        splitExclusions.add(`${inscode}|${sorted[i].tIdx}`);
      }
    }
  }

  // Build N×N weight matrix with three-level contributions
  const weights: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let cIdx = 0; cIdx < n; cIdx++) {
    for (const vh of assignments[cIdx]) {
      const key = vh.inscode.toUpperCase();

      for (let tIdx = 0; tIdx < n; tIdx++) {
        // Hospital level: originalIndex² × histPortion / 500 — 大医院主导
        // 用 originalIndex 而非 vh.index，避免拆分对单份权重的稀释:
        //   不拆: vh.index = originalIndex,行为不变
        //   拆 n 份: 每份贡献 = orig² × histPortion / 500,n 份合计 ≈ orig²/500 (恢复设计意图)
        if (histInscodes[tIdx].has(key)) {
          if (splitExclusions.has(`${key}|${tIdx}`)) continue;

          const histPortion = histPortions[tIdx].get(key);
          const portionWeight = histPortion !== undefined ? histPortion : 1;
          weights[cIdx][tIdx] += (vh.originalIndex * vh.originalIndex * portionWeight) / 500;
        }

        // District level: +100 per hospital in a shared district
        if (vh.district && histDistricts[tIdx].has(vh.district)) {
          weights[cIdx][tIdx] += 100;
        }

        // City level: +50 per hospital in a shared city
        if (vh.city && histCities[tIdx].has(vh.city)) {
          weights[cIdx][tIdx] += 50;
        }
      }
    }
  }

  // Handle lock constraints: boost weights for allowed territory mappings
  // For split hospitals, each cluster containing a portion gets boosted toward all allowed territories
  // so the Hungarian algorithm can find a valid one-to-one mapping
  if (lockMap && lockMap.size > 0) {
    for (let cIdx = 0; cIdx < n; cIdx++) {
      for (const vh of assignments[cIdx]) {
        const allowedSet = lockMap.get(vh.inscode);
        if (allowedSet && allowedSet.size > 0) {
          for (const tIdx of allowedSet) {
            if (tIdx < n) {
              weights[cIdx][tIdx] += 1e12;
            }
          }
          break; // only need to check one locked VH per cluster
        }
      }
    }
  }

  // [DIAG] 诊断含拆分医院的 cluster 权重，看医院级是否被拆分稀释
  for (let cIdx = 0; cIdx < n; cIdx++) {
    const splits = assignments[cIdx].filter(vh => vh.portion < 0.999);
    if (splits.length === 0) continue;
    const splitInfo = [...new Set(splits.map(vh => `${vh.insname.substring(0, 14)}(orig=${vh.originalIndex.toFixed(0)},vh.idx=${vh.index.toFixed(0)},p=${vh.portion.toFixed(2)})`))].join(' + ');
    console.log(`\n[匹配诊断] cluster${cIdx} 含拆分: ${splitInfo}`);
    // 列出 cluster 里所有医院 + 是否被 lockMap 锁定
    if (lockMap) {
      const lockedHere = assignments[cIdx].filter(vh => lockMap.has(vh.inscode));
      if (lockedHere.length > 0) {
        const lockInfo = lockedHere.map(vh => {
          const allowed = [...lockMap.get(vh.inscode)!].map(idx => territories[idx]?.trtyCode || `T${idx}`).join('|');
          return `${vh.insname.substring(0, 12)}→[${allowed}]`;
        }).join(', ');
        console.log(`  ⚠ cluster${cIdx} 含锁定医院: ${lockInfo}`);
      }
    }
    console.log(`  ${'territory'.padEnd(14)} ${'医院级'.padStart(8)} ${'区县级'.padStart(6)} ${'城市级'.padStart(6)} ${'lock'.padStart(6)} ${'总权重'.padStart(10)}`);
    const rows: { trty: string; hospW: number; distW: number; cityW: number; lockW: number; total: number }[] = [];
    for (let tIdx = 0; tIdx < n; tIdx++) {
      let hospW = 0, distW = 0, cityW = 0, lockW = 0;
      for (const vh of assignments[cIdx]) {
        const key = vh.inscode.toUpperCase();
        if (histInscodes[tIdx].has(key) && !splitExclusions.has(`${key}|${tIdx}`)) {
          const portionWeight = histPortions[tIdx].get(key) ?? 1;
          hospW += (vh.originalIndex * vh.originalIndex * portionWeight) / 500;
        }
        if (vh.district && histDistricts[tIdx].has(vh.district)) distW += 100;
        if (vh.city && histCities[tIdx].has(vh.city)) cityW += 50;
      }
      if (lockMap) {
        for (const vh of assignments[cIdx]) {
          const allowedSet = lockMap.get(vh.inscode);
          if (allowedSet && allowedSet.has(tIdx)) { lockW = 1e12; break; }
        }
      }
      const total = hospW + distW + cityW + lockW;
      if (total > 0) {
        rows.push({ trty: territories[tIdx]?.trtyCode || `T${tIdx}`, hospW, distW, cityW, lockW, total });
      }
    }
    rows.sort((a, b) => b.total - a.total);
    for (const r of rows.slice(0, 8)) {
      console.log(`  ${r.trty.padEnd(14)} ${r.hospW.toFixed(0).padStart(8)} ${r.distW.toFixed(0).padStart(6)} ${r.cityW.toFixed(0).padStart(6)} ${(r.lockW > 0 ? '1e12' : '-').padStart(6)} ${r.total.toFixed(0).padStart(10)}`);
    }
  }

  // Run Hungarian algorithm for maximum weight matching
  const matching = hungarianMaxWeight(weights);

  // Reorder assignments based on matching
  const reordered: VirtualHospital[][] = Array.from({ length: n }, () => []);
  const used = new Set<number>();

  for (let cIdx = 0; cIdx < n; cIdx++) {
    const tIdx = matching[cIdx];
    if (tIdx >= 0 && tIdx < n && !used.has(tIdx)) {
      reordered[tIdx] = assignments[cIdx];
      used.add(tIdx);
    }
  }

  // Place any unmatched clusters in remaining slots
  let nextSlot = 0;
  for (let cIdx = 0; cIdx < n; cIdx++) {
    if (matching[cIdx] < 0 || matching[cIdx] >= n || !used.has(matching[cIdx])) {
      while (nextSlot < n && reordered[nextSlot].length > 0) nextSlot++;
      if (nextSlot < n) {
        reordered[nextSlot] = assignments[cIdx];
        nextSlot++;
      }
    }
  }

  return reordered;
}

// Build lock map: inscode -> set of territory indices whose LEL matches
function buildLockMap(lockAssignments: LockAssignment[], territories: Territory[]): LockMap {
  const lockMap: LockMap = new Map();
  // Map LEL -> territory indices
  const lelToIndices = new Map<string, number[]>();
  for (let i = 0; i < territories.length; i++) {
    const lel = territories[i].lel;
    if (lel) {
      if (!lelToIndices.has(lel)) lelToIndices.set(lel, []);
      lelToIndices.get(lel)!.push(i);
    }
  }

  for (const la of lockAssignments) {
    const indices = lelToIndices.get(la.lel);
    if (indices && indices.length > 0) {
      if (!lockMap.has(la.inscode)) lockMap.set(la.inscode, new Set());
      for (const idx of indices) {
        lockMap.get(la.inscode)!.add(idx);
      }
    }
  }

  return lockMap;
}

// Merge results from multiple product groups
function mergeResults(
  results: OptimizationResult[],
  hospitals: Hospital[],
  historicalAssignments?: import('@/types').HistoricalAssignment[]
): OptimizationResult {
  if (results.length === 0) {
    return {
      assignments: [],
      territoryResults: [],
      score: 0,
      constraintsSatisfied: 0,
      constraintsTotal: 0,
      details: ['无产品组数据'],
      productGroup: '',
    };
  }

  if (results.length === 1) return results[0];

  const allAssignments: Assignment[] = [];
  const allTerritoryResults: TerritoryResult[] = [];
  const allDetails: string[] = [];
  let totalScore = 0;
  let totalSatisfied = 0;
  let totalConstraints = 0;

  for (const r of results) {
    allAssignments.push(...r.assignments);
    allTerritoryResults.push(...r.territoryResults);
    allDetails.push(`--- 产品组: ${r.productGroup || '未知'} ---`);
    allDetails.push(...r.details);
    totalScore += r.score;
    totalSatisfied += r.constraintsSatisfied;
    totalConstraints += r.constraintsTotal;
  }

  const merged: OptimizationResult = {
    assignments: allAssignments,
    territoryResults: allTerritoryResults,
    score: totalScore / results.length,
    constraintsSatisfied: totalSatisfied,
    constraintsTotal: totalConstraints,
    details: allDetails,
    productGroup: '', // merged across groups
  };

  if (historicalAssignments && historicalAssignments.length > 0) {
    merged.changeRate = computeChangeRate(allAssignments, hospitals, historicalAssignments);
  }

  return merged;
}

// ============================================================
// Change rate calculation
// ============================================================

function computeChangeRate(
  newAssignments: Assignment[],
  hospitals: Hospital[],
  historicalAssignments: import('@/types').HistoricalAssignment[]
): { total: number; changed: number; rate: number } {
  // Build historical map: inscode -> trtyCode
  const histMap = new Map<string, string>();
  for (const ha of historicalAssignments) {
    histMap.set(ha.inscode, ha.trtyCode);
  }

  // Build new map: inscode -> trtyCode (use primary assignment, i.e. highest ratio)
  const inscodeMap = new Map(hospitals.map((h) => [h.id, h.inscode]));
  const newMap = new Map<string, string>();
  for (const a of newAssignments) {
    const inscode = inscodeMap.get(a.hospitalId);
    if (!inscode) continue;
    // For split hospitals, track the territory with highest ratio
    if (!newMap.has(inscode) || (a.splitRatio && a.splitRatio > 0.5)) {
      newMap.set(inscode, a.territoryName);
    }
  }

  // Compare
  let total = 0;
  let changed = 0;
  for (const [inscode, histTrty] of histMap) {
    const newTrty = newMap.get(inscode);
    if (newTrty === undefined) continue; // hospital not in current data
    total++;
    if (newTrty !== histTrty) changed++;
  }

  return {
    total,
    changed,
    rate: total > 0 ? changed / total : 0,
  };
}
