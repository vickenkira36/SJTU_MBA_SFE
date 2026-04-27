'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Territory, Hospital, RegionConstraintParams, Constraint } from '@/types';
import { Scale } from 'lucide-react';

interface RegionConstraintEditorProps {
  hospitals: Hospital[];
  territories: Territory[];
  constraints: Constraint[];
  onChange: (params: RegionConstraintParams[]) => void;
  onThresholdChange: (constraintId: string, threshold: number) => void;
  initialParams?: RegionConstraintParams[];
  hasRegionData: boolean;
}

function generateDefaults(hospitals: Hospital[], territories: Territory[], constraints: Constraint[]): RegionConstraintParams[] {
  const indexRangeC = constraints.find((c) => c.type === 'index_range');
  const capacityC = constraints.find((c) => c.type === 'capacity');
  const cityLimitC = constraints.find((c) => c.type === 'city_limit');
  const distanceC = constraints.find((c) => c.type === 'geographic_distance');
  const splitC = constraints.find((c) => c.type === 'split_count' || c.type === 'hospital_split');
  const historicalC = constraints.find((c) => c.type === 'historical_stability');
  const districtC = constraints.find((c) => c.type === 'district_concentration');

  const globalIndexMin = indexRangeC ? Number(indexRangeC.value) || 800 : 800;
  const globalIndexMax = indexRangeC?.value2 != null ? Number(indexRangeC.value2) : 1200;
  const globalCapacity = capacityC ? Number(capacityC.value) || 15 : 15;
  const globalCityLimit = cityLimitC ? Number(cityLimitC.value) || 3 : 3;
  const globalDistance = distanceC ? Number(distanceC.value) || 200 : 200;
  const globalSplitThreshold = splitC?.value2 != null ? Number(splitC.value2) : 1500;
  const globalIndexThreshold = indexRangeC?.threshold ?? 200;
  const globalCapacityThreshold = capacityC?.threshold ?? 1;
  const globalCityThreshold = cityLimitC?.threshold ?? 1;
  const globalDistanceThreshold = distanceC?.threshold ?? 10;
  const globalHistoricalThreshold = historicalC?.threshold ?? 200;
  const globalDistrictThreshold = districtC?.threshold ?? 1;

  const groups = new Map<string, { hospitals: Hospital[]; territories: Territory[] }>();

  for (const t of territories) {
    const key = `${t.region || '未知'}|${t.productGroup || ''}`;
    if (!groups.has(key)) groups.set(key, { hospitals: [], territories: [] });
    groups.get(key)!.territories.push(t);
  }

  for (const h of hospitals) {
    const matchingKeys = Array.from(groups.keys()).filter((k) => {
      const pg = k.split('|')[1];
      return !pg || pg === h.productGroup;
    });
    for (const key of matchingKeys) {
      const regionTerritories = groups.get(key)!.territories;
      const regionProvinces = new Set(regionTerritories.map((t) => t.province));
      if (regionProvinces.has(h.province)) {
        groups.get(key)!.hospitals.push(h);
      }
    }
  }

  const params: RegionConstraintParams[] = [];

  for (const [key, { territories: rTerritories }] of groups) {
    const [region, productGroup] = key.split('|');
    if (rTerritories.length === 0) continue;

    params.push({
      region,
      productGroup,
      indexMin: globalIndexMin,
      indexMax: globalIndexMax,
      capacityMax: globalCapacity,
      cityLimitMax: globalCityLimit,
      maxDistanceKm: globalDistance,
      splitThreshold: globalSplitThreshold,
      indexThreshold: globalIndexThreshold,
      capacityThreshold: globalCapacityThreshold,
      cityThreshold: globalCityThreshold,
      distanceThreshold: globalDistanceThreshold,
      historicalThreshold: globalHistoricalThreshold,
      districtThreshold: globalDistrictThreshold,
    });
  }

  return params.sort((a, b) => a.region.localeCompare(b.region) || a.productGroup.localeCompare(b.productGroup));
}

function getGlobalRow(constraints: Constraint[]) {
  const indexRangeC = constraints.find((c) => c.type === 'index_range');
  const capacityC = constraints.find((c) => c.type === 'capacity');
  const cityLimitC = constraints.find((c) => c.type === 'city_limit');
  const distanceC = constraints.find((c) => c.type === 'geographic_distance');
  const splitC = constraints.find((c) => c.type === 'split_count' || c.type === 'hospital_split');
  const historicalC = constraints.find((c) => c.type === 'historical_stability');
  const districtC = constraints.find((c) => c.type === 'district_concentration');

  return {
    indexMin: indexRangeC ? Number(indexRangeC.value) || 800 : 800,
    indexMax: indexRangeC?.value2 != null ? Number(indexRangeC.value2) : 1200,
    capacityMax: capacityC ? Number(capacityC.value) || 15 : 15,
    cityLimitMax: cityLimitC ? Number(cityLimitC.value) || 3 : 3,
    maxDistanceKm: distanceC ? Number(distanceC.value) || 200 : 200,
    splitThreshold: splitC?.value2 != null ? Number(splitC.value2) : 1500,
    indexThreshold: indexRangeC?.threshold ?? 200,
    capacityThreshold: capacityC?.threshold ?? 1,
    cityThreshold: cityLimitC?.threshold ?? 1,
    distanceThreshold: distanceC?.threshold ?? 10,
    historicalThreshold: historicalC?.threshold ?? 200,
    districtThreshold: districtC?.threshold ?? 1,
    indexRangeId: indexRangeC?.id,
    capacityId: capacityC?.id,
    cityLimitId: cityLimitC?.id,
    distanceId: distanceC?.id,
    historicalId: historicalC?.id,
    districtId: districtC?.id,
  };
}

export default function RegionConstraintEditor({
  hospitals, territories, constraints, onChange, onThresholdChange, initialParams, hasRegionData,
}: RegionConstraintEditorProps) {
  const defaults = useMemo(() => generateDefaults(hospitals, territories, constraints), [hospitals, territories, constraints]);
  const [params, setParams] = useState<RegionConstraintParams[]>(initialParams || defaults);
  const global = useMemo(() => getGlobalRow(constraints), [constraints]);

  const constraintTypes = useMemo(() => new Set(constraints.map((c) => c.type)), [constraints]);
  const showIndexRange = constraintTypes.has('index_range');
  const showCapacity = constraintTypes.has('capacity');
  const showCityLimit = constraintTypes.has('city_limit');
  const showDistance = constraintTypes.has('geographic_distance');
  const showSplitCount = constraintTypes.has('split_count') || constraintTypes.has('hospital_split');
  const showHistorical = constraintTypes.has('historical_stability');
  const showDistrict = constraintTypes.has('district_concentration');

  const hasAnyColumn = showIndexRange || showCapacity || showCityLimit || showDistance || showSplitCount || showHistorical || showDistrict;

  useEffect(() => {
    onChange(params);
  }, [params, onChange]);

  useEffect(() => {
    if (!initialParams) {
      setParams(defaults);
    }
  }, [defaults, initialParams]);

  const updateParam = useCallback((index: number, field: keyof RegionConstraintParams, value: number) => {
    setParams((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const hasProductGroup = params.some((p) => p.productGroup);

  if (!hasAnyColumn) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-gray-400" />
          <span className="text-sm text-gray-500">上方未设置可调整的约束条件</span>
        </div>
      </div>
    );
  }

  const numCell = (value: number, onChangeVal: (v: number) => void, min = 0, step = 1, width = 'w-16') => (
    <td className="px-1 py-2 text-center">
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value);
          if (!isNaN(v) && v >= min) onChangeVal(v);
        }}
        className={`${width} text-center border border-gray-200 rounded px-1 py-0.5 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400`}
        min={min}
        step={step}
      />
    </td>
  );

  const readonlyCell = (value: string | number) => (
    <td className="px-1 py-2 text-center text-sm text-gray-600">{value}</td>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Scale className="h-5 w-5 text-blue-600" />
        <h3 className="text-sm font-semibold text-gray-800">约束参数与惩罚阈值</h3>
        <span className="text-xs text-gray-500">（阈值列：超出多少 = 1份惩罚）</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-gray-600 font-medium" rowSpan={2}>
                {hasRegionData ? '大区' : '范围'}
              </th>
              {hasProductGroup && (
                <th className="px-3 py-2 text-left text-gray-600 font-medium" rowSpan={2}>产品组</th>
              )}
              {showIndexRange && (
                <th className="px-2 py-1 text-center text-gray-600 font-medium border-b border-gray-200" colSpan={3}>Index 范围</th>
              )}
              {showCapacity && (
                <th className="px-2 py-1 text-center text-gray-600 font-medium border-b border-gray-200" colSpan={2}>医院上限</th>
              )}
              {showCityLimit && (
                <th className="px-2 py-1 text-center text-gray-600 font-medium border-b border-gray-200" colSpan={2}>城市上限</th>
              )}
              {showDistance && (
                <th className="px-2 py-1 text-center text-gray-600 font-medium border-b border-gray-200" rowSpan={2}>辖区距离(km)</th>
              )}
              {showSplitCount && (
                <th className="px-2 py-1 text-center text-gray-600 font-medium border-b border-gray-200" rowSpan={2}>AB岗拆分条件</th>
              )}
              {showHistorical && (
                <th className="px-2 py-1 text-center text-gray-600 font-medium border-b border-gray-200" rowSpan={2}>历史阈值</th>
              )}
              {showDistrict && (
                <th className="px-2 py-1 text-center text-gray-600 font-medium border-b border-gray-200" rowSpan={2}>区县阈值</th>
              )}
            </tr>
            <tr>
              {showIndexRange && (
                <>
                  <th className="px-1 py-1 text-center text-gray-400 font-normal text-xs">下限</th>
                  <th className="px-1 py-1 text-center text-gray-400 font-normal text-xs">上限</th>
                  <th className="px-1 py-1 text-center text-blue-500 font-normal text-xs">阈值</th>
                </>
              )}
              {showCapacity && (
                <>
                  <th className="px-1 py-1 text-center text-gray-400 font-normal text-xs">限制</th>
                  <th className="px-1 py-1 text-center text-blue-500 font-normal text-xs">阈值</th>
                </>
              )}
              {showCityLimit && (
                <>
                  <th className="px-1 py-1 text-center text-gray-400 font-normal text-xs">限制</th>
                  <th className="px-1 py-1 text-center text-blue-500 font-normal text-xs">阈值</th>
                </>
              )}
              {/* distance: single column, no sub-headers needed */}
            </tr>
          </thead>
          <tbody>
            {/* Global row */}
            <tr className="border-t-2 border-blue-200 bg-blue-50/30">
              <td className="px-3 py-2.5 text-blue-700 font-semibold">全局默认</td>
              {hasProductGroup && <td className="px-3 py-2.5 text-gray-400">—</td>}
              {showIndexRange && (
                <>
                  {readonlyCell(global.indexMin)}
                  {readonlyCell(global.indexMax)}
                  {numCell(global.indexThreshold, (v) => global.indexRangeId && onThresholdChange(global.indexRangeId, v), 50, 50)}
                </>
              )}
              {showCapacity && (
                <>
                  {readonlyCell(global.capacityMax)}
                  {numCell(global.capacityThreshold, (v) => global.capacityId && onThresholdChange(global.capacityId, v), 1, 1)}
                </>
              )}
              {showCityLimit && (
                <>
                  {readonlyCell(global.cityLimitMax)}
                  {numCell(global.cityThreshold, (v) => global.cityLimitId && onThresholdChange(global.cityLimitId, v), 1, 1)}
                </>
              )}
              {showDistance && readonlyCell(global.maxDistanceKm)}
              {showSplitCount && readonlyCell(global.splitThreshold)}
              {showHistorical && (
                numCell(global.historicalThreshold, (v) => global.historicalId && onThresholdChange(global.historicalId, v), 50, 50)
              )}
              {showDistrict && (
                numCell(global.districtThreshold, (v) => global.districtId && onThresholdChange(global.districtId, v), 1, 1)
              )}
            </tr>

            {/* Region rows */}
            {hasRegionData && params.map((p, i) => (
              <tr key={`${p.region}-${p.productGroup}`} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-800 font-medium">{p.region}</td>
                {hasProductGroup && (
                  <td className="px-3 py-2 text-gray-600">{p.productGroup || '—'}</td>
                )}
                {showIndexRange && (
                  <>
                    {numCell(p.indexMin, (v) => updateParam(i, 'indexMin', v), 0, 100)}
                    {numCell(p.indexMax, (v) => updateParam(i, 'indexMax', v), 0, 100)}
                    {numCell(p.indexThreshold, (v) => updateParam(i, 'indexThreshold', v), 50, 50)}
                  </>
                )}
                {showCapacity && (
                  <>
                    {numCell(p.capacityMax, (v) => updateParam(i, 'capacityMax', v), 1)}
                    {numCell(p.capacityThreshold, (v) => updateParam(i, 'capacityThreshold', v), 1)}
                  </>
                )}
                {showCityLimit && (
                  <>
                    {numCell(p.cityLimitMax, (v) => updateParam(i, 'cityLimitMax', v), 1)}
                    {numCell(p.cityThreshold, (v) => updateParam(i, 'cityThreshold', v), 1)}
                  </>
                )}
                {showDistance && (
                  numCell(p.maxDistanceKm, (v) => updateParam(i, 'maxDistanceKm', v), 10, 50)
                )}
                {showSplitCount && (
                  numCell(p.splitThreshold, (v) => updateParam(i, 'splitThreshold', v), 500, 100, 'w-20')
                )}
                {showHistorical && (
                  numCell(p.historicalThreshold, (v) => updateParam(i, 'historicalThreshold', v), 50, 50)
                )}
                {showDistrict && (
                  numCell(p.districtThreshold, (v) => updateParam(i, 'districtThreshold', v), 1, 1)
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
