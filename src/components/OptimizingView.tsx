'use client';

import { Loader2, MapPin } from 'lucide-react';

interface OptimizingViewProps {
  progress: {
    current: number;
    total: number;
    province: string;
  };
  hospitalCount: number;
  territoryCount: number;
}

export default function OptimizingView({
  progress,
  hospitalCount,
  territoryCount,
}: OptimizingViewProps) {
  const percent = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="max-w-lg mx-auto mt-20">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-10 text-center">
        {/* Spinner */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <Loader2 className="h-16 w-16 text-blue-500 animate-spin" />
            <MapPin className="h-6 w-6 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
        </div>

        <h2 className="text-xl font-bold text-gray-900 mb-2">正在优化分配</h2>
        <p className="text-sm text-gray-500 mb-6">
          {hospitalCount} 家医院 → {territoryCount} 个辖区
        </p>

        {/* Progress bar */}
        {progress.total > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
              <span>
                省份进度：{progress.current} / {progress.total}
              </span>
              <span className="font-semibold text-blue-600">{percent}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Current province */}
        {progress.province && (
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg text-sm text-blue-700">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            正在计算：{progress.province}
          </div>
        )}

        {progress.total === 0 && (
          <p className="text-sm text-gray-400 mt-2">正在初始化...</p>
        )}

        <p className="text-xs text-gray-400 mt-6">
          请勿关闭页面，计算完成后将自动跳转到结果页
        </p>
      </div>
    </div>
  );
}
