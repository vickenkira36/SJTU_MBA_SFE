'use client';

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, Cell,
} from 'recharts';
import { ChevronDown, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { Hospital, Territory, HistoricalAssignment, OptimizationResult } from '@/types';
import { buildComparison, ComparisonResult, TerritoryComparison, BalanceStats } from '@/lib/comparison';

interface ComparisonViewProps {
  result: OptimizationResult;
  hospitals: Hospital[];
  territories: Territory[];
  historicalAssignments: HistoricalAssignment[];
  indexMin: number;
  indexMax: number;
}

export default function ComparisonView({
  result, hospitals, territories, historicalAssignments, indexMin, indexMax,
}: ComparisonViewProps) {
  const comparison = useMemo(
    () => buildComparison(result, hospitals, territories, historicalAssignments, indexMin, indexMax),
    [result, hospitals, territories, historicalAssignments, indexMin, indexMax],
  );

  const [activeTab, setActiveTab] = useState<'territory' | 'hospital' | 'balance'>('territory');

  const tabs = [
    { id: 'territory' as const, label: '辖区对比' },
    { id: 'hospital' as const, label: '医院变动' },
    { id: 'balance' as const, label: '均衡性' },
  ];

  const handleExport = () => exportComparisonExcel(comparison);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2">
        <h3 className="text-base font-bold text-gray-900">历史对比分析：当前分配 vs 历史分配</h3>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          导出对比报告
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="border-b border-gray-200 px-6">
        <div className="flex gap-6">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="p-6">
        {activeTab === 'territory' && (
          <TerritoryTab comparison={comparison} indexMin={indexMin} indexMax={indexMax} />
        )}
        {activeTab === 'hospital' && (
          <HospitalTab comparison={comparison} />
        )}
        {activeTab === 'balance' && (
          <BalanceTab comparison={comparison} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// 辖区对比 Tab
// ============================================================

function TerritoryTab({ comparison, indexMin, indexMax }: {
  comparison: ComparisonResult; indexMin: number; indexMax: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const { territoryComparisons } = comparison;
  const displayData = showAll ? territoryComparisons : territoryComparisons.slice(0, 20);

  // 图表数据：按当前 index 降序排列（spec 4.2）
  const chartData = [...territoryComparisons]
    .sort((a, b) => b.currIndex - a.currIndex)
    .map(tc => ({
      name: tc.trtyCode,
      rep: tc.rep,
      历史: Math.round(tc.histIndex),
      当前: Math.round(tc.currIndex),
      changeMeasure: Math.round(tc.changeMeasure),
    }));

  return (
    <div>
      {/* 分组柱状图 */}
      <h4 className="text-sm font-semibold text-gray-700 mb-3">辖区 Index 对比</h4>
      <div className="overflow-x-auto mb-6">
        <div style={{ minWidth: Math.max(800, chartData.length * 60) }}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} barGap={2} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value) => [Number(value).toLocaleString()]}
                labelFormatter={(label) => {
                  const item = chartData.find(d => d.name === label);
                  return `${label} (${item?.rep || ''})`;
                }}
                labelStyle={{ color: '#1f2937', fontWeight: 600 }}
              />
              <Legend />
              <ReferenceLine y={indexMin} stroke="#EF4444" strokeDasharray="5 5" />
              <ReferenceLine y={indexMax} stroke="#EF4444" strokeDasharray="5 5" />
              <Bar dataKey="历史" fill="#94a3b8" radius={[2, 2, 0, 0]} />
              <Bar dataKey="当前" fill="#3b82f6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 辖区对比表（含下钻） */}
      <h4 className="text-sm font-semibold text-gray-700 mb-3">辖区变动明细</h4>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-gray-600 w-8"></th>
              <th className="px-3 py-2 text-left text-gray-600">辖区</th>
              <th className="px-3 py-2 text-left text-gray-600">Rep</th>
              <th className="px-3 py-2 text-right text-gray-600">变化度量</th>
              <th className="px-3 py-2 text-right text-gray-600">历史Index</th>
              <th className="px-3 py-2 text-right text-gray-600">当前Index</th>
              <th className="px-3 py-2 text-right text-gray-600">差异</th>
              <th className="px-3 py-2 text-center text-gray-600">保持</th>
              <th className="px-3 py-2 text-center text-gray-600">新增</th>
              <th className="px-3 py-2 text-center text-gray-600">移除</th>
              <th className="px-3 py-2 text-center text-gray-600">调入</th>
            </tr>
          </thead>
          <tbody>
            {displayData.map(tc => (
              <TerritoryRow key={tc.trtyCode} tc={tc} />
            ))}
          </tbody>
        </table>
      </div>

      {territoryComparisons.length > 20 && (
        <div className="text-center mt-3">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            {showAll ? '收起' : `展开全部 ${territoryComparisons.length} 个辖区`}
          </button>
        </div>
      )}
    </div>
  );
}

function TerritoryRow({ tc }: { tc: TerritoryComparison }) {
  const [expanded, setExpanded] = useState(false);
  const indexDiff = tc.currIndex - tc.histIndex;
  const hasChanges = tc.added.length + tc.removed.length + tc.incoming.length > 0;

  return (
    <>
      <tr
        className={`border-t border-gray-100 ${hasChanges ? 'cursor-pointer hover:bg-gray-50' : ''}`}
        onClick={() => hasChanges && setExpanded(!expanded)}
      >
        <td className="px-3 py-2 text-gray-400">
          {hasChanges && (expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
        </td>
        <td className="px-3 py-2 text-gray-800 font-medium whitespace-nowrap">{tc.trtyCode}</td>
        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
          <div>{tc.rep || '-'}</div>
          {tc.lel && <div className="text-[10px] text-gray-400">LEL: {tc.lel}</div>}
        </td>
        <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
          {tc.changeMeasure > 0 ? (
            <span className="text-amber-600">{tc.changeMeasure.toFixed(0)}</span>
          ) : (
            <span className="text-gray-300">0</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{tc.histIndex.toFixed(0)}</td>
        <td className="px-3 py-2 text-right text-gray-800 font-medium whitespace-nowrap">{tc.currIndex.toFixed(0)}</td>
        <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${indexDiff > 0 ? 'text-green-600' : indexDiff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
          {indexDiff > 0 ? '+' : ''}{indexDiff.toFixed(0)}
        </td>
        <td className="px-3 py-2 text-center text-gray-500">{tc.kept.length}</td>
        <td className="px-3 py-2 text-center text-green-600 font-medium">{tc.added.length || '-'}</td>
        <td className="px-3 py-2 text-center text-red-600 font-medium">{tc.removed.length || '-'}</td>
        <td className="px-3 py-2 text-center text-amber-600 font-medium">{tc.incoming.length || '-'}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={11} className="bg-gray-50/80 px-6 py-4">
            <DrillDown tc={tc} />
          </td>
        </tr>
      )}
    </>
  );
}

function DrillDown({ tc }: { tc: TerritoryComparison }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      {/* 保持 */}
      {tc.kept.length > 0 && (
        <ChangeList title="保持" items={tc.kept} color="gray" />
      )}
      {/* 新增 */}
      {tc.added.length > 0 && (
        <ChangeList title="新增" items={tc.added} color="green" />
      )}
      {/* 移除 */}
      {tc.removed.length > 0 && (
        <ChangeList title="移除" items={tc.removed} color="red" showFrom />
      )}
      {/* 调入 */}
      {tc.incoming.length > 0 && (
        <ChangeList title="调入" items={tc.incoming} color="amber" showFrom />
      )}
    </div>
  );
}

function ChangeList({ title, items, color, showFrom }: {
  title: string; items: { inscode: string; insname: string; index: number; territoryIndex: number; historicalTerritories: string[]; currentTerritories: string[] }[];
  color: string; showFrom?: boolean;
}) {
  const colorMap: Record<string, { bg: string; text: string; badge: string }> = {
    gray: { bg: 'bg-gray-50', text: 'text-gray-700', badge: 'bg-gray-200 text-gray-600' },
    green: { bg: 'bg-green-50', text: 'text-green-700', badge: 'bg-green-100 text-green-700' },
    red: { bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  };
  const c = colorMap[color] || colorMap.gray;
  const indexSum = items.reduce((s, h) => s + h.territoryIndex, 0);

  return (
    <div className={`rounded-lg p-3 ${c.bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${c.badge}`}>{title}</span>
        <span className="text-[10px] text-gray-400">{items.length} 家 · Index合计 {indexSum.toFixed(0)}</span>
      </div>
      <div className="space-y-1">
        {items.map(h => (
          <div key={h.inscode} className={`flex items-center justify-between ${c.text}`}>
            <span className="truncate mr-2">{h.insname}</span>
            <div className="flex items-center gap-2 shrink-0">
              {showFrom && h.historicalTerritories.length > 0 && (
                <span className="text-[10px] text-gray-400">← {h.historicalTerritories.join(',')}</span>
              )}
              <span className="font-mono font-medium">{h.territoryIndex.toFixed(0)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 医院变动 Tab
// ============================================================

function HospitalTab({ comparison }: { comparison: ComparisonResult }) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<'all' | 'kept' | 'added' | 'removed' | 'coverage_added' | 'coverage_removed' | 'reassigned'>('all');
  const { hospitalChanges, summary } = comparison;

  const filtered = filter === 'all' ? hospitalChanges : hospitalChanges.filter(h => h.changeType === filter);
  const display = showAll ? filtered : filtered.slice(0, 50);

  const filterButtons: { id: typeof filter; label: string; count: number; color: string }[] = [
    { id: 'all', label: '全部', count: summary.totalHospitals, color: 'bg-gray-100 text-gray-700' },
    { id: 'kept', label: '保持', count: summary.keptCount, color: 'bg-gray-100 text-gray-600' },
    { id: 'added', label: '新增', count: summary.addedCount, color: 'bg-green-100 text-green-700' },
    { id: 'removed', label: '移除', count: summary.removedCount, color: 'bg-red-100 text-red-700' },
    { id: 'coverage_added', label: '新增覆盖', count: summary.coverageAddedCount, color: 'bg-blue-100 text-blue-700' },
    { id: 'coverage_removed', label: '减少覆盖', count: summary.coverageRemovedCount, color: 'bg-orange-100 text-orange-700' },
    { id: 'reassigned', label: '调整分配', count: summary.reassignedCount, color: 'bg-amber-100 text-amber-700' },
  ];

  const changeTypeLabel: Record<string, { text: string; color: string }> = {
    kept: { text: '保持', color: 'text-gray-500' },
    added: { text: '新增', color: 'text-green-600' },
    removed: { text: '移除', color: 'text-red-600' },
    coverage_added: { text: '新增覆盖', color: 'text-blue-600' },
    coverage_removed: { text: '减少覆盖', color: 'text-orange-600' },
    reassigned: { text: '调整分配', color: 'text-amber-600' },
  };

  return (
    <div>
      {/* 筛选按钮 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {filterButtons.map(fb => (
          <button
            key={fb.id}
            onClick={() => { setFilter(fb.id); setShowAll(false); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === fb.id ? fb.color + ' ring-2 ring-offset-1 ring-blue-400' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            {fb.label} ({fb.count})
          </button>
        ))}
      </div>

      {/* 医院表格 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-gray-600">inscode</th>
              <th className="px-3 py-2 text-left text-gray-600">insname</th>
              <th className="px-3 py-2 text-left text-gray-600">省份</th>
              <th className="px-3 py-2 text-left text-gray-600">城市</th>
              <th className="px-3 py-2 text-right text-gray-600">Index</th>
              <th className="px-3 py-2 text-left text-gray-600">历史辖区</th>
              <th className="px-3 py-2 text-left text-gray-600">当前辖区</th>
              <th className="px-3 py-2 text-center text-gray-600">变动</th>
            </tr>
          </thead>
          <tbody>
            {display.map(h => {
              const ct = changeTypeLabel[h.changeType];
              return (
                <tr key={h.inscode} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-800 font-mono text-xs">{h.inscode}</td>
                  <td className="px-3 py-2 text-gray-800 font-medium">{h.insname}</td>
                  <td className="px-3 py-2 text-gray-600">{h.province}</td>
                  <td className="px-3 py-2 text-gray-600">{h.city}</td>
                  <td className="px-3 py-2 text-right font-semibold text-blue-700">{h.index.toFixed(1)}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{h.historicalTerritories.join(', ') || '-'}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{h.currentTerritories.join(', ') || '-'}</td>
                  <td className={`px-3 py-2 text-center text-xs font-medium ${ct.color}`}>{ct.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 50 && (
        <div className="text-center mt-3">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            {showAll ? '收起' : `展开全部 ${filtered.length} 家医院`}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 均衡性 Tab
// ============================================================

// ============================================================
// Excel 导出
// ============================================================

function exportComparisonExcel(comparison: ComparisonResult) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: 辖区对比
  const trtyData = comparison.territoryComparisons.map(tc => ({
    '辖区代码': tc.trtyCode,
    'Rep': tc.rep,
    'LEL': tc.lel,
    '省份': tc.province,
    '变化度量': Math.round(tc.changeMeasure),
    '历史Index': Math.round(tc.histIndex),
    '当前Index': Math.round(tc.currIndex),
    'Index差异': Math.round(tc.currIndex - tc.histIndex),
    '历史医院数': tc.histHospitalCount,
    '当前医院数': tc.currHospitalCount,
    '历史城市数': tc.histCityCount,
    '当前城市数': tc.currCityCount,
    '保持': tc.kept.length,
    '新增': tc.added.length,
    '移除': tc.removed.length,
    '调入': tc.incoming.length,
  }));
  const ws1 = XLSX.utils.json_to_sheet(trtyData);
  XLSX.utils.book_append_sheet(wb, ws1, '辖区对比');

  // Sheet 2: 医院变动明细
  const changeTypeMap: Record<string, string> = {
    kept: '保持', added: '新增', removed: '移除',
    coverage_added: '新增覆盖', coverage_removed: '减少覆盖', reassigned: '调整分配',
  };
  const hospData = comparison.hospitalChanges.map(h => ({
    'inscode': h.inscode,
    'insname': h.insname,
    '省份': h.province,
    '城市': h.city,
    'Index': h.index,
    '历史辖区': h.historicalTerritories.join(', ') || '-',
    '当前辖区': h.currentTerritories.join(', ') || '-',
    '变动类型': changeTypeMap[h.changeType] || h.changeType,
  }));
  const ws2 = XLSX.utils.json_to_sheet(hospData);
  XLSX.utils.book_append_sheet(wb, ws2, '医院变动明细');

  // Sheet 3: 均衡性统计
  const balData = [
    { '指标': 'Index 平均值', '历史': comparison.histBalance.mean.toFixed(1), '当前': comparison.currBalance.mean.toFixed(1) },
    { '指标': 'Index 标准差', '历史': comparison.histBalance.stdDev.toFixed(1), '当前': comparison.currBalance.stdDev.toFixed(1) },
    { '指标': 'Index 极差', '历史': comparison.histBalance.range.toFixed(1), '当前': comparison.currBalance.range.toFixed(1) },
    { '指标': 'Index 最小值', '历史': comparison.histBalance.min.toFixed(1), '当前': comparison.currBalance.min.toFixed(1) },
    { '指标': 'Index 最大值', '历史': comparison.histBalance.max.toFixed(1), '当前': comparison.currBalance.max.toFixed(1) },
    { '指标': '变异系数 CV', '历史': (comparison.histBalance.cv * 100).toFixed(2) + '%', '当前': (comparison.currBalance.cv * 100).toFixed(2) + '%' },
    { '指标': '达标率', '历史': (comparison.histBalance.complianceRate * 100).toFixed(1) + '%', '当前': (comparison.currBalance.complianceRate * 100).toFixed(1) + '%' },
  ];
  const ws3 = XLSX.utils.json_to_sheet(balData);
  XLSX.utils.book_append_sheet(wb, ws3, '均衡性统计');

  XLSX.writeFile(wb, 'SFE辖区分配对比报告.xlsx');
}

function BalanceTab({ comparison }: { comparison: ComparisonResult }) {
  const { histBalance, currBalance } = comparison;

  const rows: { label: string; histVal: string; currVal: string; improved: boolean | null; format: (b: BalanceStats) => string }[] = [
    {
      label: 'Index 平均值',
      histVal: histBalance.mean.toFixed(1),
      currVal: currBalance.mean.toFixed(1),
      improved: null,
      format: b => b.mean.toFixed(1),
    },
    {
      label: 'Index 标准差',
      histVal: histBalance.stdDev.toFixed(1),
      currVal: currBalance.stdDev.toFixed(1),
      improved: currBalance.stdDev < histBalance.stdDev,
      format: b => b.stdDev.toFixed(1),
    },
    {
      label: 'Index 极差',
      histVal: histBalance.range.toFixed(1),
      currVal: currBalance.range.toFixed(1),
      improved: currBalance.range < histBalance.range,
      format: b => b.range.toFixed(1),
    },
    {
      label: 'Index 最小值',
      histVal: histBalance.min.toFixed(1),
      currVal: currBalance.min.toFixed(1),
      improved: currBalance.min > histBalance.min,
      format: b => b.min.toFixed(1),
    },
    {
      label: 'Index 最大值',
      histVal: histBalance.max.toFixed(1),
      currVal: currBalance.max.toFixed(1),
      improved: currBalance.max < histBalance.max,
      format: b => b.max.toFixed(1),
    },
    {
      label: '变异系数 CV',
      histVal: (histBalance.cv * 100).toFixed(2) + '%',
      currVal: (currBalance.cv * 100).toFixed(2) + '%',
      improved: currBalance.cv < histBalance.cv,
      format: b => (b.cv * 100).toFixed(2) + '%',
    },
    {
      label: '达标率',
      histVal: (histBalance.complianceRate * 100).toFixed(1) + '%',
      currVal: (currBalance.complianceRate * 100).toFixed(1) + '%',
      improved: currBalance.complianceRate > histBalance.complianceRate,
      format: b => (b.complianceRate * 100).toFixed(1) + '%',
    },
  ];

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-3">均衡性指标对比</h4>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-gray-600">指标</th>
              <th className="px-4 py-2 text-right text-gray-600">历史</th>
              <th className="px-4 py-2 text-right text-gray-600">当前</th>
              <th className="px-4 py-2 text-center text-gray-600">趋势</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-t border-gray-100">
                <td className="px-4 py-2.5 text-gray-700 font-medium">{r.label}</td>
                <td className="px-4 py-2.5 text-right text-gray-500">{r.histVal}</td>
                <td className="px-4 py-2.5 text-right text-gray-800 font-semibold">{r.currVal}</td>
                <td className="px-4 py-2.5 text-center">
                  {r.improved === null ? (
                    <span className="text-gray-300">—</span>
                  ) : r.improved ? (
                    <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                      <TrendingUp className="h-3 w-3" /> 改善
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium">
                      <TrendingDown className="h-3 w-3" /> 恶化
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
