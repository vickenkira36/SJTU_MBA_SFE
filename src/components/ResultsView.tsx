'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import {
  Download,
  ArrowLeft,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { OptimizationResult, Hospital, Territory, Constraint } from '@/types';

const TerritoryMap = dynamic(() => import('./TerritoryMap'), { ssr: false });

interface ResultsViewProps {
  result: OptimizationResult;
  hospitals: Hospital[];
  territories: Territory[];
  constraints: Constraint[];
  onBack: () => void;
  onRestart: () => void;
}

const COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#EF4444', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#0EA5E9', '#A855F7', '#22C55E',
];

export default function ResultsView({
  result,
  hospitals,
  territories,
  constraints,
  onBack,
  onRestart,
}: ResultsViewProps) {
  // Product group filter
  const productGroups = useMemo(() => {
    const groups = new Set(result.assignments.map((a) => a.productGroup).filter(Boolean));
    return Array.from(groups).sort();
  }, [result]);
  const [selectedProductGroup, setSelectedProductGroup] = useState<string>('');

  // Filtered result based on product group selection
  const filteredResult = useMemo(() => {
    if (!selectedProductGroup) return result;
    return {
      ...result,
      assignments: result.assignments.filter((a) => a.productGroup === selectedProductGroup),
      territoryResults: result.territoryResults.filter((tr) =>
        tr.territory.productGroup === selectedProductGroup
      ),
    };
  }, [result, selectedProductGroup]);

  // Chart 1: Index distribution data
  const indexData = useMemo(
    () =>
      filteredResult.territoryResults
        .map((tr) => ({
          name: tr.territory.trtyCode,
          rep: tr.territory.rep,
          Index总值: parseFloat(tr.totalIndex.toFixed(1)),
        }))
        .sort((a, b) => b.Index总值 - a.Index总值),
    [filteredResult]
  );

  // Chart 2: Territory summary with city details, sorted by index desc
  const territorySummary = useMemo(() => {
    return filteredResult.territoryResults
      .map((tr) => {
        const citySet = new Set<string>();
        tr.hospitals.forEach((h) => {
          if (h.city) citySet.add(h.city);
        });
        const cities = Array.from(citySet).sort();
        return {
          trtyCode: tr.territory.trtyCode,
          rep: tr.territory.rep,
          cityCount: cities.length,
          hospitalCount: tr.hospitalCount,
          cities: cities.join(', '),
          totalIndex: tr.totalIndex,
        };
      })
      .sort((a, b) => b.totalIndex - a.totalIndex);
  }, [filteredResult]);

  // Chart 3: Hospital-territory detail sorted by territory index desc, then hospital index desc
  const hospitalDetail = useMemo(() => {
    // Build territory total index lookup
    const territoryIndexMap = new Map(
      filteredResult.territoryResults.map((tr) => [tr.territory.id, tr.totalIndex])
    );

    return filteredResult.assignments
      .map((a) => {
        const hospital = hospitals.find((h) => h.id === a.hospitalId);
        return {
          inscode: hospital?.inscode || '',
          insname: a.hospitalName,
          city: hospital?.city || '',
          province: hospital?.province || '',
          productGroup: a.productGroup || hospital?.productGroup || '',
          index: hospital?.index || 0,
          sales: hospital?.sales || 0,
          potential: hospital?.potential || 0,
          territoryName: a.territoryName,
          territoryId: a.territoryId,
          territoryTotalIndex: territoryIndexMap.get(a.territoryId) || 0,
          splitRatio: a.splitRatio,
          isSplit: a.splitRatio !== undefined && a.splitRatio < 1,
        };
      })
      .sort((a, b) => {
        if (b.territoryTotalIndex !== a.territoryTotalIndex) {
          return b.territoryTotalIndex - a.territoryTotalIndex;
        }
        return b.index - a.index;
      });
  }, [filteredResult, hospitals]);

  // Index range from constraints
  const indexConstraint = [...constraints].find((c) => c.type === 'index_range') || {
    value: 800,
    value2: 1200,
  };
  const indexMin = Number(indexConstraint.value) || 800;
  const indexMax = indexConstraint.value2 ?? 1200;

  const handleExport = () => {
    const exportData = hospitalDetail.map((h) => ({
      inscode: h.inscode,
      insname: h.insname,
      产品组: h.productGroup,
      城市: h.city,
      省份: h.province,
      销量: h.sales,
      潜力: h.potential,
      index: h.index,
      分配辖区: h.territoryName,
      分配比例: h.isSplit ? `${((h.splitRatio ?? 1) * 100).toFixed(0)}%` : '100%',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, '分配结果');

    const summaryData = territorySummary.map((t) => ({
      TRTY_CODE: t.trtyCode,
      Rep: t.rep,
      医院数量: t.hospitalCount,
      城市数量: t.cityCount,
      城市明细: t.cities,
      Index总值: parseFloat(t.totalIndex.toFixed(2)),
    }));
    const ws2 = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws2, '辖区汇总');

    XLSX.writeFile(wb, 'SFE辖区分配结果.xlsx');
  };

  const handleExportConstraintDetails = () => {
    if (!result.provinceDetails || result.provinceDetails.length === 0) return;

    const data = result.provinceDetails.map((d) => ({
      省份: d.province,
      约束条件: d.constraint,
      是否满足: d.satisfied ? '满足' : '未满足',
      详情: d.detail,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 10 },
      { wch: 20 },
      { wch: 8 },
      { wch: 60 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, '约束详情');
    XLSX.writeFile(wb, 'SFE约束满足详情.xlsx');
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">分配结果</h2>
          <p className="text-gray-500 text-sm mt-1">
            {hospitals.length}家医院 → {territories.length}个辖区
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="h-4 w-4" />
            导出Excel
          </button>
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
          >
            <ArrowLeft className="h-4 w-4" />
            调整约束
          </button>
        </div>
      </div>

      {/* Product Group Filter */}
      {productGroups.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm font-medium text-gray-600">产品组筛选:</span>
          <select
            value={selectedProductGroup}
            onChange={(e) => setSelectedProductGroup(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">全部产品组</option>
            {productGroups.map((pg) => (
              <option key={pg} value={pg}>{pg}</option>
            ))}
          </select>
          {selectedProductGroup && (
            <button
              onClick={() => setSelectedProductGroup('')}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      {/* Score Cards */}
      <div className={`grid grid-cols-1 gap-4 mb-6 ${result.changeRate ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
          <div className="text-sm opacity-80">优化得分</div>
          <div className="text-3xl font-bold mt-1">{result.score.toFixed(0)}</div>
          <div className="text-xs opacity-70 mt-1">满分100</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-sm text-gray-500">约束满足</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {result.constraintsSatisfied}/{result.constraintsTotal}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {result.constraintsTotal > 0
              ? `${((result.constraintsSatisfied / result.constraintsTotal) * 100).toFixed(0)}%`
              : '无约束'}
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-sm text-gray-500">Index范围</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {Math.min(...result.territoryResults.map((r) => r.totalIndex)).toFixed(0)}
            ~
            {Math.max(...result.territoryResults.map((r) => r.totalIndex)).toFixed(0)}
          </div>
          <div className="text-xs text-gray-400 mt-1">目标: {indexMin}~{indexMax}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-sm text-gray-500">平均每辖区</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {(hospitals.length / territories.length).toFixed(1)}
          </div>
          <div className="text-xs text-gray-400 mt-1">家医院</div>
        </div>
        {result.changeRate && (
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-sm text-gray-500">历史变动率</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {(result.changeRate.rate * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {result.changeRate.changed}/{result.changeRate.total} 家医院变动
            </div>
          </div>
        )}
      </div>

      {/* Constraint Details */}
      {result.details.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800 text-sm">约束满足汇总</h3>
            {result.provinceDetails && result.provinceDetails.length > 0 && (
              <button
                onClick={handleExportConstraintDetails}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                下载约束详情
              </button>
            )}
          </div>
          <div className="space-y-2">
            {result.details.map((detail, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                  style={{ backgroundColor: 'rgb(11, 65, 205)' }}
                />
                <span className="text-gray-700">{detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Map */}
      <TerritoryMap result={result} hospitals={hospitals} territories={territories} />

      {/* Chart 1: Index Distribution */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">图表1：各辖区 Index 分布</h3>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={indexData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value) => [Number(value).toFixed(1), 'Index总值']}
              labelFormatter={(label) => {
                const item = indexData.find((d) => d.name === label);
                return `${label} (${item?.rep || ''})`;
              }}
            />
            <ReferenceLine
              y={indexMin}
              stroke="#EF4444"
              strokeDasharray="5 5"
              label={{ value: `下限${indexMin}`, position: 'right', fontSize: 11, fill: '#EF4444' }}
            />
            <ReferenceLine
              y={indexMax}
              stroke="#EF4444"
              strokeDasharray="5 5"
              label={{ value: `上限${indexMax}`, position: 'right', fontSize: 11, fill: '#EF4444' }}
            />
            <Bar dataKey="Index总值" radius={[4, 4, 0, 0]}>
              {indexData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.Index总值 >= indexMin && entry.Index总值 <= indexMax
                      ? '#3B82F6'
                      : '#EF4444'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: Territory Summary — city count, hospital count, city list */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">图表2：各辖区城市与医院分布</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-gray-600 font-semibold">辖区代码</th>
                <th className="px-4 py-3 text-left text-gray-600 font-semibold">代表</th>
                <th className="px-4 py-3 text-center text-gray-600 font-semibold">城市数</th>
                <th className="px-4 py-3 text-center text-gray-600 font-semibold">医院数</th>
                <th className="px-4 py-3 text-right text-gray-600 font-semibold">Index总值</th>
                <th className="px-4 py-3 text-left text-gray-600 font-semibold">城市明细</th>
              </tr>
            </thead>
            <tbody>
              {territorySummary.map((t, i) => (
                <tr key={`${t.trtyCode}-${i}`} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span
                      className="inline-block px-2.5 py-1 rounded-lg text-xs font-semibold text-white"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    >
                      {t.trtyCode}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{t.rep}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-cyan-50 text-cyan-700 font-bold text-sm">
                      {t.cityCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-700 font-bold text-sm">
                      {t.hospitalCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">
                    {t.totalIndex.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs leading-relaxed max-w-md">
                    {t.cities}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chart 3: Hospital-Territory Detail sorted by index desc */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          图表3：医院辖区明细（按 Index 降序）
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-gray-600 font-semibold w-8">#</th>
                <th className="px-3 py-2 text-left text-gray-600 font-semibold">inscode</th>
                <th className="px-3 py-2 text-left text-gray-600 font-semibold">insname</th>
                <th className="px-3 py-2 text-left text-gray-600 font-semibold">城市</th>
                <th className="px-3 py-2 text-left text-gray-600 font-semibold">省份</th>
                <th className="px-3 py-2 text-right text-gray-600 font-semibold">index</th>
                <th className="px-3 py-2 text-right text-gray-600 font-semibold">销量</th>
                <th className="px-3 py-2 text-right text-gray-600 font-semibold">潜力</th>
                <th className="px-3 py-2 text-left text-gray-600 font-semibold">分配辖区</th>
                <th className="px-3 py-2 text-right text-gray-600 font-semibold">比例</th>
              </tr>
            </thead>
            <tbody>
              {hospitalDetail.map((h, idx) => {
                const colorIndex = territories.findIndex((t) => t.id === h.territoryId);
                return (
                  <tr
                    key={`${h.inscode}-${h.territoryName}-${idx}`}
                    className={`border-t border-gray-100 hover:bg-gray-50 ${h.isSplit ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="px-3 py-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{h.inscode}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {h.insname}
                      {h.isSplit && <span className="ml-1 text-xs text-yellow-600">(拆分)</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{h.city}</td>
                    <td className="px-3 py-2 text-gray-600">{h.province}</td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-700">
                      {h.index.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {h.sales ? h.sales.toLocaleString() : '-'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {h.potential ? h.potential.toLocaleString() : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="px-2 py-1 rounded-lg text-xs font-medium text-white"
                        style={{ backgroundColor: COLORS[colorIndex >= 0 ? colorIndex % COLORS.length : 0] }}
                      >
                        {h.territoryName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-sm">
                      {h.isSplit ? (
                        <span className="text-yellow-700 font-medium">
                          {((h.splitRatio ?? 1) * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-gray-400">100%</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 text-center">
        <button
          onClick={onRestart}
          className="text-sm text-gray-500 hover:text-blue-600 transition-colors"
        >
          重新开始
        </button>
      </div>
    </div>
  );
}
