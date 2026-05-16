/**
 * 分配前后比对分析工具函数
 */
import { Hospital, Territory, HistoricalAssignment, OptimizationResult, Assignment } from '@/types';

// ============================================================
// 类型定义
// ============================================================

export interface HospitalChange {
  inscode: string;
  insname: string;
  province: string;
  city: string;
  index: number;
  historicalTerritories: string[]; // trtyCode 列表
  currentTerritories: string[];   // trtyCode 列表
  changeType: 'kept' | 'added' | 'removed' | 'coverage_added' | 'coverage_removed' | 'reassigned';
}

export interface TerritoryComparison {
  trtyCode: string;
  rep: string;
  lel: string;
  province: string;
  // 历史指标
  histIndex: number;
  histHospitalCount: number;
  histCityCount: number;
  histSales: number;
  histPotential: number;
  // 当前指标
  currIndex: number;
  currHospitalCount: number;
  currCityCount: number;
  currSales: number;
  currPotential: number;
  // 变化度量：所有变动医院的 index 总和
  changeMeasure: number;
  // 辖区视角的变动明细（index 已乘以本辖区的分配比例）
  kept: DrillDownItem[];       // 本辖区历史和当前都有
  added: DrillDownItem[];      // 本辖区当前有，全局历史无（新增）
  removed: DrillDownItem[];    // 本辖区历史有，当前无
  incoming: DrillDownItem[];   // 本辖区当前有，历史不在本辖区（从其他辖区调入）
}

// 辖区下钻条目：HospitalChange + 本辖区的 index 贡献
export interface DrillDownItem extends HospitalChange {
  territoryIndex: number; // index × 本辖区分配比例
}

export interface BalanceStats {
  mean: number;
  stdDev: number;
  range: number; // 极差
  cv: number;    // 变异系数
  complianceRate: number; // 达标率
  min: number;
  max: number;
}

export interface ComparisonResult {
  territoryComparisons: TerritoryComparison[];
  hospitalChanges: HospitalChange[];
  histBalance: BalanceStats;
  currBalance: BalanceStats;
  summary: {
    totalHospitals: number;
    keptCount: number;
    addedCount: number;
    removedCount: number;
    coverageAddedCount: number;
    coverageRemovedCount: number;
    reassignedCount: number;
    changeRate: number; // 非保持的医院占比
  };
}

// ============================================================
// 均衡性统计
// ============================================================

function calcBalance(indices: number[], indexMin: number, indexMax: number): BalanceStats {
  if (indices.length === 0) {
    return { mean: 0, stdDev: 0, range: 0, cv: 0, complianceRate: 0, min: 0, max: 0 };
  }
  const n = indices.length;
  const mean = indices.reduce((a, b) => a + b, 0) / n;
  const variance = indices.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...indices);
  const max = Math.max(...indices);
  const range = max - min;
  const cv = mean > 0 ? stdDev / mean : 0;
  const compliant = indices.filter(v => v >= indexMin && v <= indexMax).length;
  const complianceRate = compliant / n;
  return { mean, stdDev, range, cv, complianceRate, min, max };
}

// ============================================================
// 主分析函数
// ============================================================

export function buildComparison(
  result: OptimizationResult,
  hospitals: Hospital[],
  territories: Territory[],
  historicalAssignments: HistoricalAssignment[],
  indexMin: number,
  indexMax: number,
): ComparisonResult {
  const hospMap = new Map(hospitals.map(h => [h.inscode.trim(), h]));
  const trtyMap = new Map(territories.map(t => [t.trtyCode.trim(), t]));
  const hospIdToInscode = new Map(hospitals.map(h => [h.id, h.inscode.trim()]));

  // 带比例的分配记录
  interface RatioEntry { inscode: string; ratio: number }

  // --- 历史：trtyCode -> RatioEntry[]，inscode -> { trtyCode, portion }[] ---
  const histByTrty = new Map<string, RatioEntry[]>();
  const histByHosp = new Map<string, { trtyCode: string; portion: number }[]>();
  for (const ha of historicalAssignments) {
    const portion = ha.portion ?? 1;
    const ins = ha.inscode.trim();
    const trty = ha.trtyCode.trim();
    if (!histByTrty.has(trty)) histByTrty.set(trty, []);
    histByTrty.get(trty)!.push({ inscode: ins, ratio: portion });
    if (!histByHosp.has(ins)) histByHosp.set(ins, []);
    histByHosp.get(ins)!.push({ trtyCode: trty, portion });
  }

  // --- 当前：trtyCode -> RatioEntry[]，inscode -> { trtyCode, splitRatio }[] ---
  const currByTrty = new Map<string, RatioEntry[]>();
  const currByHosp = new Map<string, { trtyCode: string; splitRatio: number }[]>();
  for (const a of result.assignments) {
    const inscode = hospIdToInscode.get(a.hospitalId);
    if (!inscode) continue;
    const ratio = a.splitRatio ?? 1;
    if (!currByTrty.has(a.territoryName)) currByTrty.set(a.territoryName, []);
    currByTrty.get(a.territoryName)!.push({ inscode, ratio });
    if (!currByHosp.has(inscode)) currByHosp.set(inscode, []);
    currByHosp.get(inscode)!.push({ trtyCode: a.territoryName, splitRatio: ratio });
  }

  // ============================================================
  // 医院级变动分析
  // ============================================================
  const allInscodes = new Set([...histByHosp.keys(), ...currByHosp.keys()]);
  const hospitalChanges: HospitalChange[] = [];

  for (const inscode of allInscodes) {
    const h = hospMap.get(inscode);
    const histEntries = histByHosp.get(inscode);
    const currEntries = currByHosp.get(inscode);
    const histArr = histEntries ? histEntries.map(e => e.trtyCode) : [];
    const currArr = currEntries ? currEntries.map(e => e.trtyCode) : [];

    let changeType: HospitalChange['changeType'];
    if (histArr.length === 0 && currArr.length > 0) {
      changeType = 'added';
    } else if (histArr.length > 0 && currArr.length === 0) {
      changeType = 'removed';
    } else if (histArr.length > 0 && currArr.length > 0) {
      const histSet = new Set(histArr);
      const currSet = new Set(currArr);
      // 集合完全相同 → 保持
      if (histSet.size === currSet.size && [...histSet].every(t => currSet.has(t))) {
        changeType = 'kept';
      }
      // 历史 ⊂ 当前（当前多了辖区）→ 新增覆盖
      else if ([...histSet].every(t => currSet.has(t))) {
        changeType = 'coverage_added';
      }
      // 当前 ⊂ 历史（当前少了辖区）→ 减少覆盖
      else if ([...currSet].every(t => histSet.has(t))) {
        changeType = 'coverage_removed';
      }
      // 其他（部分重叠或完全不同）→ 调整分配
      else {
        changeType = 'reassigned';
      }
    } else {
      continue;
    }



    hospitalChanges.push({
      inscode,
      insname: h?.insname || inscode,
      province: h?.province || '',
      city: h?.city || '',
      index: h?.index || 0,
      historicalTerritories: [...new Set(histArr)],
      currentTerritories: [...new Set(currArr)],
      changeType,
    });
  }

  hospitalChanges.sort((a, b) => b.index - a.index);

  // 快速查找
  const changeMap = new Map(hospitalChanges.map(hc => [hc.inscode, hc]));

  // ============================================================
  // 辖区级比对（使用比例计算 index/sales/potential）
  // ============================================================
  const allTrtyCodes = new Set([...histByTrty.keys(), ...currByTrty.keys()]);
  const territoryComparisons: TerritoryComparison[] = [];

  for (const trtyCode of allTrtyCodes) {
    const trty = trtyMap.get(trtyCode);
    const histEntries = histByTrty.get(trtyCode) || [];
    const currEntries = currByTrty.get(trtyCode) || [];
    const histInscodeSet = new Set(histEntries.map(e => e.inscode));
    const currInscodeSet = new Set(currEntries.map(e => e.inscode));

    // 历史指标（乘以 portion）
    let histIndex = 0, histSales = 0, histPotential = 0;
    const histCities = new Set<string>();
    for (const entry of histEntries) {
      const h = hospMap.get(entry.inscode);
      if (h) {
        histIndex += h.index * entry.ratio;
        histSales += h.sales * entry.ratio;
        histPotential += h.potential * entry.ratio;
        if (h.city) histCities.add(h.city);
      }
    }

    // 当前指标（乘以 splitRatio）
    let currIndex = 0, currSales = 0, currPotential = 0;
    const currCities = new Set<string>();
    for (const entry of currEntries) {
      const h = hospMap.get(entry.inscode);
      if (h) {
        currIndex += h.index * entry.ratio;
        currSales += h.sales * entry.ratio;
        currPotential += h.potential * entry.ratio;
        if (h.city) currCities.add(h.city);
      }
    }

    // 本辖区的分配比例查找表
    const currRatioMap = new Map(currEntries.map(e => [e.inscode, e.ratio]));
    const histRatioMap = new Map(histEntries.map(e => [e.inscode, e.ratio]));

    // 将 HospitalChange 转为 DrillDownItem（index 乘以本辖区比例）
    const toDrillDown = (hc: HospitalChange, ratioMap: Map<string, number>): DrillDownItem => ({
      ...hc,
      territoryIndex: hc.index * (ratioMap.get(hc.inscode) ?? 1),
    });

    // 辖区视角的变动分类
    const kept: DrillDownItem[] = [];
    const added: DrillDownItem[] = [];
    const removed: DrillDownItem[] = [];
    const incoming: DrillDownItem[] = [];

    for (const ins of currInscodeSet) {
      const hc = changeMap.get(ins);
      if (!hc) continue;
      const item = toDrillDown(hc, currRatioMap);
      if (histInscodeSet.has(ins)) {
        kept.push(item);
      } else if (hc.changeType === 'added') {
        added.push(item);
      } else {
        incoming.push(item);
      }
    }
    for (const ins of histInscodeSet) {
      if (!currInscodeSet.has(ins)) {
        const hc = changeMap.get(ins);
        if (hc) removed.push(toDrillDown(hc, histRatioMap));
      }
    }

    // 变化度量：所有变动医院的 territoryIndex 总和
    const changeMeasure =
      added.reduce((s, h) => s + h.territoryIndex, 0) +
      removed.reduce((s, h) => s + h.territoryIndex, 0) +
      incoming.reduce((s, h) => s + h.territoryIndex, 0);

    territoryComparisons.push({
      trtyCode,
      rep: trty?.rep || '',
      lel: trty?.lel || '',
      province: trty?.province || '',
      histIndex,
      histHospitalCount: histInscodeSet.size,
      histCityCount: histCities.size,
      histSales,
      histPotential,
      currIndex,
      currHospitalCount: currInscodeSet.size,
      currCityCount: currCities.size,
      currSales,
      currPotential,
      changeMeasure,
      kept: kept.sort((a, b) => b.territoryIndex - a.territoryIndex),
      added: added.sort((a, b) => b.territoryIndex - a.territoryIndex),
      removed: removed.sort((a, b) => b.territoryIndex - a.territoryIndex),
      incoming: incoming.sort((a, b) => b.territoryIndex - a.territoryIndex),
    });
  }

  // 按变化度量降序
  territoryComparisons.sort((a, b) => b.changeMeasure - a.changeMeasure);

  // ============================================================
  // 均衡性统计
  // ============================================================
  const histIndices = territoryComparisons
    .filter(tc => tc.histHospitalCount > 0)
    .map(tc => tc.histIndex);
  const currIndices = territoryComparisons
    .filter(tc => tc.currHospitalCount > 0)
    .map(tc => tc.currIndex);

  const histBalance = calcBalance(histIndices, indexMin, indexMax);
  const currBalance = calcBalance(currIndices, indexMin, indexMax);

  // ============================================================
  // 汇总
  // ============================================================
  const keptCount = hospitalChanges.filter(h => h.changeType === 'kept').length;
  const addedCount = hospitalChanges.filter(h => h.changeType === 'added').length;
  const removedCount = hospitalChanges.filter(h => h.changeType === 'removed').length;
  const coverageAddedCount = hospitalChanges.filter(h => h.changeType === 'coverage_added').length;
  const coverageRemovedCount = hospitalChanges.filter(h => h.changeType === 'coverage_removed').length;
  const reassignedCount = hospitalChanges.filter(h => h.changeType === 'reassigned').length;
  const totalHospitals = hospitalChanges.length;
  const changeRate = totalHospitals > 0 ? (totalHospitals - keptCount) / totalHospitals : 0;

  return {
    territoryComparisons,
    hospitalChanges,
    histBalance,
    currBalance,
    summary: { totalHospitals, keptCount, addedCount, removedCount, coverageAddedCount, coverageRemovedCount, reassignedCount, changeRate },
  };
}
