'use client';

import { useState, useMemo } from 'react';
import { AlgorithmMode, Territory } from '@/types';
import { ArrowRight, History, Shuffle, ChevronDown, ChevronUp } from 'lucide-react';

interface AlgoSelectProps {
  onSelect: (mode: AlgorithmMode, selectedProvinces?: string[]) => void;
  onBack: () => void;
  territories?: Territory[];
  hasHistoricalData?: boolean;
}

export default function AlgoSelect({ onSelect, onBack, territories, hasHistoricalData }: AlgoSelectProps) {
  const [selected, setSelected] = useState<AlgorithmMode>(hasHistoricalData ? 'option2' : 'option1');

  // Province selector state
  const allProvinces = useMemo(() => {
    if (!territories) return [];
    return Array.from(new Set(territories.map(t => t.province).filter(Boolean))).sort();
  }, [territories]);
  const [selectedProvinces, setSelectedProvinces] = useState<Set<string>>(() => new Set(allProvinces));
  const [provinceExpanded, setProvinceExpanded] = useState(false);

  const toggleProvince = (p: string) => {
    setSelectedProvinces(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };
  const toggleAll = () => {
    if (selectedProvinces.size === allProvinces.length) {
      setSelectedProvinces(new Set());
    } else {
      setSelectedProvinces(new Set(allProvinces));
    }
  };

  const options: {
    mode: AlgorithmMode;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    pros: string[];
    cons: string[];
  }[] = [
    {
      mode: 'option1',
      title: '方案一：历史惩罚法',
      subtitle: '在优化过程中通过惩罚函数保持历史稳定性',
      icon: <History className="h-6 w-6" />,
      pros: [
        '优化过程中直接考虑历史分配',
        '可通过权重参数调节稳定性强度',
      ],
      cons: [
        '历史惩罚可能压过均衡目标',
        'Index 均衡性可能受影响',
      ],
    },
    {
      mode: 'option2',
      title: '方案二：两阶段法',
      subtitle: '先做纯均衡优化，再用匈牙利算法匹配历史辖区号',
      icon: <Shuffle className="h-6 w-6" />,
      pros: [
        'Index 均衡性不受历史数据干扰',
        '均衡性与稳定性完全解耦',
      ],
      cons: [
        '历史延续性取决于匹配结果',
        '无法在优化中微调稳定性权重',
      ],
    },
  ];

  return (
    <div className="max-w-2xl mx-auto mt-12">
      <div className="text-center mb-8">
        <h2 className="text-xl font-bold text-gray-900">
          {hasHistoricalData ? '选择优化算法' : '运行设置'}
        </h2>
        <p className="text-sm text-gray-500 mt-2">
          {hasHistoricalData
            ? '检测到已上传历史分配数据，请选择如何处理历史辖区关系'
            : '选择要运行的省份，然后开始优化'}
        </p>
      </div>

      {hasHistoricalData && <div className="space-y-4">
        {options.map((opt) => (
          <div
            key={opt.mode}
            onClick={() => setSelected(opt.mode)}
            className={`relative p-5 rounded-xl border-2 cursor-pointer transition-all ${
              selected === opt.mode
                ? 'border-blue-500 bg-blue-50/50 shadow-md'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
            }`}
          >
            {/* Radio indicator */}
            <div className="absolute top-5 right-5">
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selected === opt.mode ? 'border-blue-500' : 'border-gray-300'
                }`}
              >
                {selected === opt.mode && (
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                )}
              </div>
            </div>

            <div className="flex items-start gap-4 pr-8">
              <div
                className={`p-2.5 rounded-lg ${
                  selected === opt.mode
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {opt.icon}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">{opt.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{opt.subtitle}</p>

                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div>
                    <p className="text-xs font-medium text-green-700 mb-1">优势</p>
                    <ul className="space-y-1">
                      {opt.pros.map((p, i) => (
                        <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                          <span className="text-green-500 mt-0.5 shrink-0">+</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-amber-700 mb-1">局限</p>
                    <ul className="space-y-1">
                      {opt.cons.map((c, i) => (
                        <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                          <span className="text-amber-500 mt-0.5 shrink-0">-</span>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>}

      {/* Province selector */}
      {allProvinces.length > 1 && (
        <div className="mt-6 border border-gray-200 rounded-xl bg-white p-4">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setProvinceExpanded(!provinceExpanded)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">
                运行省份
              </span>
              <span className="text-xs text-gray-400">
                {selectedProvinces.size === allProvinces.length
                  ? '全部'
                  : `${selectedProvinces.size}/${allProvinces.length}`}
              </span>
            </div>
            {provinceExpanded ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </div>

          {provinceExpanded && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedProvinces.size === allProvinces.length}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  全选
                </label>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {allProvinces.map((p) => (
                  <label
                    key={p}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                      selectedProvinces.has(p)
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProvinces.has(p)}
                      onChange={() => toggleProvince(p)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3 w-3"
                    />
                    {p.replace(/[省市自治区壮族回族维吾尔]/g, '').replace('特别行政', '')}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 justify-center mt-8">
        <button
          onClick={onBack}
          className="px-6 py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors border border-gray-200 rounded-xl hover:bg-gray-50"
        >
          返回上一步
        </button>
        <button
          onClick={() => onSelect(selected, selectedProvinces.size < allProvinces.length ? Array.from(selectedProvinces) : undefined)}
          disabled={selectedProvinces.size === 0}
          className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          开始优化
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
