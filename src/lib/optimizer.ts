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
    iterations: 100000,
    indexThreshold: indexC?.threshold ?? 200,
    distanceThreshold: distC?.threshold ?? 10,
    cityThreshold: cityC?.threshold ?? 1,
    capacityThreshold: capC?.threshold ?? 1,
    historicalThreshold: histC?.threshold ?? 200,
    hasHistorical: !!histC,
  };
}

// ============================================================
// 1. Preprocessing: split large-index hospitals
// ============================================================

function preprocessHospitals(hospitals: Hospital[]): VirtualHospital[] {
  const result: VirtualHospital[] = [];

  for (const h of hospitals) {
    if (h.index > 1500) {
      const numSplits = Math.floor(h.index / 1000) + 1;
      const portionIndex = h.index / numSplits;
      const portionRatio = 1.0 / numSplits;

      for (let i = 0; i < numSplits; i++) {
        result.push({
          originalId: h.id,
          inscode: h.inscode,
          insname: h.insname,
          city: h.city,
          province: h.province,
          latitude: h.latitude,
          longitude: h.longitude,
          index: portionIndex,
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
  maxDist: number;
} {
  if (group.length === 0) return { idxSum: 0, count: 0, cities: 0, maxDist: 0 };

  const idxSum = group.reduce((s, h) => s + h.index, 0);
  const count = group.length;
  const citySet = new Set(group.map((h) => h.city).filter(Boolean));
  const cities = citySet.size;

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

  return { idxSum, count, cities, maxDist };
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

    const { idxSum, count, cities, maxDist } = getGroupStats(group);

    // Index: penalize violation outside [indexMin, indexMax]
    // penalty = (超出量 / threshold) × BASE_PENALTY
    if (idxSum < ec.indexMin) {
      totalCost += ((ec.indexMin - idxSum) / ec.indexThreshold) * BASE_PENALTY;
    } else if (idxSum > ec.indexMax) {
      totalCost += ((idxSum - ec.indexMax) / ec.indexThreshold) * BASE_PENALTY;
    }

    // Distance constraint
    if (maxDist > ec.maxDistanceKm) {
      totalCost += ((maxDist - ec.maxDistanceKm) / ec.distanceThreshold) * BASE_PENALTY;
    }

    // City limit
    if (cities > ec.maxCities) {
      totalCost += ((cities - ec.maxCities) / ec.cityThreshold) * BASE_PENALTY;
    }

    // Capacity limit
    if (count > ec.maxHospitals) {
      totalCost += ((count - ec.maxHospitals) / ec.capacityThreshold) * BASE_PENALTY;
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
// 4. Local search optimization (ported from Python)
// ============================================================

function runOptimization(
  virtualHospitals: VirtualHospital[],
  territoryCount: number,
  ec: EffectiveConstraints,
  historicalMap?: HistoricalMap,
  lockMap?: LockMap
): VirtualHospital[][] {
  // Single territory: assign all hospitals directly, no optimization needed
  if (territoryCount <= 1) {
    return [virtualHospitals];
  }

  // Initial assignment: if historical data exists, use it; otherwise sort by geo + round-robin
  const assignments: VirtualHospital[][] = Array.from({ length: territoryCount }, () => []);

  if (lockMap && lockMap.size > 0) {
    // Place locked hospitals: ALL portions go to allowed territories (spread across them)
    const unplaced: VirtualHospital[] = [];
    for (const vh of virtualHospitals) {
      const allowedSet = lockMap.get(vh.inscode);
      if (allowedSet && allowedSet.size > 0) {
        // Spread split portions across allowed territories
        const allowedArr = Array.from(allowedSet).filter((idx) => idx < territoryCount);
        if (allowedArr.length > 0) {
          const tIdx = allowedArr[vh.splitId % allowedArr.length];
          assignments[tIdx].push(vh);
        } else {
          unplaced.push(vh);
        }
      } else {
        unplaced.push(vh);
      }
    }
    // Place remaining using historical or round-robin
    if (historicalMap && historicalMap.size > 0) {
      const stillUnplaced: VirtualHospital[] = [];
      for (const vh of unplaced) {
        const histSet = historicalMap.get(vh.inscode);
        if (histSet && histSet.size > 0) {
          // Spread split portions across historical territories
          const histArr = Array.from(histSet).filter((idx) => idx < territoryCount);
          if (histArr.length > 0) {
            const tIdx = histArr[vh.splitId % histArr.length];
            assignments[tIdx].push(vh);
          } else {
            stillUnplaced.push(vh);
          }
        } else {
          stillUnplaced.push(vh);
        }
      }
      let rr = 0;
      for (const vh of stillUnplaced) {
        assignments[rr % territoryCount].push(vh);
        rr++;
      }
    } else {
      let rr = 0;
      for (const vh of unplaced) {
        assignments[rr % territoryCount].push(vh);
        rr++;
      }
    }
  } else if (historicalMap && historicalMap.size > 0) {
    // Place hospitals in their historical territories
    // Split portions are spread across historical territories
    const unplaced: VirtualHospital[] = [];
    for (const vh of virtualHospitals) {
      const histSet = historicalMap.get(vh.inscode);
      if (histSet && histSet.size > 0) {
        const histArr = Array.from(histSet).filter((idx) => idx < territoryCount);
        if (histArr.length > 0) {
          const tIdx = histArr[vh.splitId % histArr.length];
          assignments[tIdx].push(vh);
        } else {
          unplaced.push(vh);
        }
      } else {
        unplaced.push(vh);
      }
    }
    // Round-robin remaining
    let rr = 0;
    for (const vh of unplaced) {
      assignments[rr % territoryCount].push(vh);
      rr++;
    }
  } else {
    const sorted = [...virtualHospitals].sort((a, b) =>
      a.latitude !== b.latitude ? a.latitude - b.latitude : a.longitude - b.longitude
    );
    for (let i = 0; i < sorted.length; i++) {
      assignments[i % territoryCount].push(sorted[i]);
    }
  }

  let currentCost = calculateCost(assignments, ec, historicalMap, lockMap);
  const iterations = ec.iterations;

  for (let step = 0; step < iterations; step++) {
    const mode = Math.random();

    // Pick two random territories
    const t1 = Math.floor(Math.random() * territoryCount);
    let t2 = Math.floor(Math.random() * territoryCount);
    while (t2 === t1) t2 = Math.floor(Math.random() * territoryCount);

    if (mode < 0.6 && assignments[t1].length > 0) {
      const hIdx = Math.floor(Math.random() * assignments[t1].length);
      const h = assignments[t1][hIdx];

      // Skip locked hospitals — they cannot be moved
      if (lockMap && lockMap.has(h.inscode)) continue;

      // Skip if target territory already has another portion of the same hospital
      if (h.portion < 0.999 && assignments[t2].some(vh => vh.originalId === h.originalId)) continue;

      assignments[t1].splice(hIdx, 1);
      assignments[t2].push(h);

      const newCost = calculateCost(assignments, ec, historicalMap, lockMap);
      if (newCost < currentCost) {
        currentCost = newCost;
      } else {
        assignments[t2].pop();
        assignments[t1].splice(hIdx, 0, h);
      }
    } else if (mode >= 0.6 && assignments[t1].length > 0 && assignments[t2].length > 0) {
      const idx1 = Math.floor(Math.random() * assignments[t1].length);
      const idx2 = Math.floor(Math.random() * assignments[t2].length);

      const h1 = assignments[t1][idx1];
      const h2 = assignments[t2][idx2];

      // Skip if either hospital is locked
      if (lockMap && (lockMap.has(h1.inscode) || lockMap.has(h2.inscode))) continue;

      // Skip if swap would cause split portions of the same hospital to cluster
      if (h1.portion < 0.999 && assignments[t2].some(vh => vh !== h2 && vh.originalId === h1.originalId)) continue;
      if (h2.portion < 0.999 && assignments[t1].some(vh => vh !== h1 && vh.originalId === h2.originalId)) continue;

      assignments[t1][idx1] = h2;
      assignments[t2][idx2] = h1;

      const newCost = calculateCost(assignments, ec, historicalMap, lockMap);
      if (newCost < currentCost) {
        currentCost = newCost;
      } else {
        assignments[t1][idx1] = h1;
        assignments[t2][idx2] = h2;
      }
    }
  }

  return assignments;
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
  const virtualHospitals = preprocessHospitals(hospitals);

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
        };
      }
    }

    const virtualHospitals = preprocessHospitals(hospitals);

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

    // option2: disable historical penalty so SA optimizes purely for balance
    const saEc = mode === 'option2' ? { ...ec, hasHistorical: false, historicalThreshold: 0 } : ec;
    let assignments = runOptimization(virtualHospitals, territories.length, saEc, historicalMap, lockMap);

    // option2 phase 2: match clusters to historical territory IDs
    if (mode === 'option2' && historicalAssignments && historicalAssignments.length > 0) {
      const provHistorical = historicalAssignments.filter((ha) => {
        const provInscodes = new Set(hospitals.map((h) => h.inscode));
        return provInscodes.has(ha.inscode);
      });
      if (provHistorical.length > 0) {
        assignments = matchClustersToHistory(assignments, territories, provHistorical, lockMap);
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

    const virtualHospitals = preprocessHospitals(provHospitals);
    // option2: disable historical penalty so SA optimizes purely for balance
    const saEc = mode === 'option2' ? { ...ec, hasHistorical: false, historicalThreshold: 0 } : ec;
    let assignments = runOptimization(virtualHospitals, provTerritories.length, saEc, provHistMap, provLockMap);

    // option2 phase 2: match clusters to historical territory IDs per province
    if (mode === 'option2' && historicalAssignments && historicalAssignments.length > 0) {
      const provInscodes = new Set(provHospitals.map((h) => h.inscode));
      const provHistorical = historicalAssignments.filter((ha) => provInscodes.has(ha.inscode));
      if (provHistorical.length > 0) {
        assignments = matchClustersToHistory(assignments, provTerritories, provHistorical, provLockMap);
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
// Reorders assignments array so that cluster indices align with historical territories
function matchClustersToHistory(
  assignments: VirtualHospital[][],
  territories: Territory[],
  historicalAssignments: import('@/types').HistoricalAssignment[],
  lockMap?: LockMap
): VirtualHospital[][] {
  const n = assignments.length; // = territory count

  // Build historical territory composition: trtyIdx -> Map<inscode, indexPortion>
  const hospHistCount = new Map<string, number>();
  for (const ha of historicalAssignments) {
    hospHistCount.set(ha.inscode, (hospHistCount.get(ha.inscode) || 0) + 1);
  }

  const trtyToIdx = new Map(territories.map((t, i) => [t.trtyCode, i]));
  const histComposition: Map<string, number>[] = Array.from({ length: n }, () => new Map());

  for (const ha of historicalAssignments) {
    const tIdx = trtyToIdx.get(ha.trtyCode);
    if (tIdx === undefined || tIdx >= n) continue;
    const count = hospHistCount.get(ha.inscode) || 1;
    // We don't have the hospital index here, so use 1/count as a normalized weight
    // The actual overlap calculation below will use real index values
    histComposition[tIdx].set(ha.inscode, 1.0 / count);
  }

  // Build cluster composition: clusterIdx -> Map<inscode, totalPortionIndex>
  const clusterComposition: Map<string, number>[] = Array.from({ length: n }, () => new Map());
  for (let cIdx = 0; cIdx < n; cIdx++) {
    for (const vh of assignments[cIdx]) {
      const prev = clusterComposition[cIdx].get(vh.inscode) || 0;
      clusterComposition[cIdx].set(vh.inscode, prev + vh.index);
    }
  }

  // Build N×N overlap matrix: overlap[cluster][histTerritory]
  // overlap = sum of index for hospitals shared between cluster and historical territory
  const weights: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let cIdx = 0; cIdx < n; cIdx++) {
    for (const [inscode, clusterIndex] of clusterComposition[cIdx]) {
      const histCount = hospHistCount.get(inscode) || 0;
      if (histCount === 0) continue;

      // This hospital appears in some historical territories
      for (const ha of historicalAssignments) {
        if (ha.inscode !== inscode) continue;
        const hTIdx = trtyToIdx.get(ha.trtyCode);
        if (hTIdx === undefined || hTIdx >= n) continue;
        // Weight = cluster's index for this hospital / histCount (proportional share)
        weights[cIdx][hTIdx] += clusterIndex / histCount;
      }
    }
  }

  // Handle lock constraints: if a cluster contains locked hospitals,
  // it must match to the territory of the locked LEL
  const forcedMatches = new Map<number, number>(); // clusterIdx -> territoryIdx
  if (lockMap && lockMap.size > 0) {
    for (let cIdx = 0; cIdx < n; cIdx++) {
      for (const vh of assignments[cIdx]) {
        const allowedSet = lockMap.get(vh.inscode);
        if (allowedSet && allowedSet.size > 0) {
          // This cluster must map to one of the allowed territory indices
          for (const tIdx of allowedSet) {
            if (tIdx < n) {
              forcedMatches.set(cIdx, tIdx);
              break;
            }
          }
          break;
        }
      }
    }
  }

  // Apply forced matches by setting very high weights
  for (const [cIdx, tIdx] of forcedMatches) {
    weights[cIdx][tIdx] = 1e12;
  }

  // Run Hungarian algorithm
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
    if (matching[cIdx] < 0 || matching[cIdx] >= n || used.has(-1)) {
      // Find next empty slot
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
