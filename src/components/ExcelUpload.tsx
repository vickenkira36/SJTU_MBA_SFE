'use client';

import { useState, useCallback, useMemo } from 'react';
import { Upload, FileSpreadsheet, Check, AlertCircle, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Hospital, Territory, HistoricalAssignment, LockAssignment } from '@/types';
import { parseHospitals, parseHospitalBusiness, loadHcoMaster, joinWithMaster, parseTerritories, parseHistoricalAssignments, parseLockAssignments, validateHospitals, validateTerritories, validateCrossTable, ValidationResult, fillMissingDistricts, HOSPITAL_FIELD_MAP, TERRITORY_FIELD_MAP, HISTORICAL_FIELD_MAP, LOCK_FIELD_MAP } from '@/lib/excel-parser';

interface ExcelUploadProps {
  onDataLoaded: (hospitals: Hospital[], territories: Territory[], historicalAssignments?: HistoricalAssignment[], lockAssignments?: LockAssignment[]) => void;
  initialHospitals?: Hospital[];
  initialTerritories?: Territory[];
  initialHistorical?: HistoricalAssignment[];
  initialLockAssignments?: LockAssignment[];
}

// 通用预览表格：根据原始列名和 field map 动态渲染
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DataPreview({ title, columns, data, fieldMap, maxRows = 5 }: {
  title: string;
  columns: string[];
  data: any[];
  fieldMap: Record<string, string>;
  maxRows?: number;
}) {
  if (data.length === 0 || columns.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}（前{Math.min(maxRows, data.length)}条）</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, maxRows).map((row, i) => (
              <tr key={i} className="border-t border-gray-100">
                {columns.map((col) => {
                  const key = fieldMap[col.trim()] || col.trim();
                  const val = (row as Record<string, unknown>)[key];
                  const display = val == null || val === '' ? '-' : String(val);
                  return (
                    <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap">{display}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ExcelUpload({ onDataLoaded, initialHospitals, initialTerritories, initialHistorical, initialLockAssignments }: ExcelUploadProps) {
  const [hospitals, setHospitals] = useState<Hospital[]>(initialHospitals || []);
  const [territories, setTerritories] = useState<Territory[]>(initialTerritories || []);
  const [historicalAssignments, setHistoricalAssignments] = useState<HistoricalAssignment[]>(initialHistorical || []);
  const [lockAssignments, setLockAssignments] = useState<LockAssignment[]>(initialLockAssignments || []);
  const [hospitalFile, setHospitalFile] = useState<string>(initialHospitals?.length ? `已加载 ${initialHospitals.length} 家医院` : '');
  const [territoryFile, setTerritoryFile] = useState<string>(initialTerritories?.length ? `已加载 ${initialTerritories.length} 个辖区` : '');
  const [historicalFile, setHistoricalFile] = useState<string>(initialHistorical?.length ? `已加载 ${initialHistorical.length} 条记录` : '');
  const [lockFile, setLockFile] = useState<string>(initialLockAssignments?.length ? `已加载 ${initialLockAssignments.length} 条锁定` : '');
  const [hospitalError, setHospitalError] = useState<string>('');
  const [territoryError, setTerritoryError] = useState<string>('');
  const [historicalError, setHistoricalError] = useState<string>('');
  const [lockError, setLockError] = useState<string>('');
  const [hospitalColumns, setHospitalColumns] = useState<string[]>([]);
  const [territoryColumns, setTerritoryColumns] = useState<string[]>([]);
  const [historicalColumns, setHistoricalColumns] = useState<string[]>([]);
  const [lockColumns, setLockColumns] = useState<string[]>([]);
  const [joinStatus, setJoinStatus] = useState<string>('');

  const handleHospitalUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setHospitalError('');
      setJoinStatus('');
      try {
        const buffer = await file.arrayBuffer();

        // 尝试解析为业务数据格式（无地理列），与主数据 join
        setJoinStatus('正在加载 HCO 主数据...');
        const master = await loadHcoMaster();
        const { rows: bizRows, columns } = parseHospitalBusiness(buffer);
        const { hospitals: joined, skipped } = joinWithMaster(bizRows, master);

        if (joined.length === 0) {
          // 主数据匹配失败，回退到完整格式解析
          setJoinStatus('');
          const { hospitals: parsed, columns: fullCols } = parseHospitals(buffer);

          // 补全缺失的区县
          const missingCount = parsed.filter((h) => !h.district && h.longitude && h.latitude).length;
          if (missingCount > 0) {
            setJoinStatus(`正在补全 ${missingCount} 家医院的区县信息...`);
            const filled = await fillMissingDistricts(parsed, (done, total) => {
              setJoinStatus(`正在补全区县信息 (${done}/${total})...`);
            });
            setJoinStatus(filled > 0 ? `已通过高德地图补全 ${filled} 家医院的区县` : '');
          }

          setHospitals(parsed);
          setHospitalFile(file.name);
          setHospitalColumns(fullCols);
        } else {
          // 主数据匹配成功
          const statusParts = [`已关联主数据，匹配 ${joined.length} 家医院`];
          if (skipped > 0) statusParts.push(`${skipped} 条 inscode 未匹配（已跳过）`);

          // 补全主数据中缺失的区县
          const missingDistrict = joined.filter((h) => !h.district && h.longitude && h.latitude).length;
          if (missingDistrict > 0) {
            setJoinStatus(statusParts.join('，') + `，正在补全 ${missingDistrict} 家区县...`);
            await fillMissingDistricts(joined);
          }

          setJoinStatus(statusParts.join('，'));
          setHospitals(joined);
          setHospitalFile(file.name);
          setHospitalColumns(columns);
        }
      } catch (err) {
        setHospitalError(err instanceof Error ? err.message : '解析失败');
        setJoinStatus('');
      }
    },
    []
  );

  const handleTerritoryUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setTerritoryError('');
      try {
        const buffer = await file.arrayBuffer();
        const { territories: parsed, columns } = parseTerritories(buffer);
        setTerritories(parsed);
        setTerritoryFile(file.name);
        setTerritoryColumns(columns);
      } catch (err) {
        setTerritoryError(err instanceof Error ? err.message : '解析失败');
      }
    },
    []
  );

  const handleHistoricalUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setHistoricalError('');
      try {
        const buffer = await file.arrayBuffer();
        const { assignments: parsed, columns } = parseHistoricalAssignments(buffer);
        setHistoricalAssignments(parsed);
        setHistoricalFile(file.name);
        setHistoricalColumns(columns);
      } catch (err) {
        setHistoricalError(err instanceof Error ? err.message : '解析失败');
      }
    },
    []
  );

  const handleLockUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setLockError('');
      try {
        const buffer = await file.arrayBuffer();
        const { lockAssignments: parsed, columns } = parseLockAssignments(buffer);
        setLockAssignments(parsed);
        setLockFile(file.name);
        setLockColumns(columns);
      } catch (err) {
        setLockError(err instanceof Error ? err.message : '解析失败');
      }
    },
    []
  );

  const [loadingTest, setLoadingTest] = useState(false);

  const handleLoadTestData = useCallback(async () => {
    setLoadingTest(true);
    try {
      const [hRes, tRes, histRes, lockRes] = await Promise.all([
        fetch('/test-hospitals.xlsx'),
        fetch('/test-territories.xlsx'),
        fetch('/test-historical.xlsx'),
        fetch('/test-lock-assignments.xlsx'),
      ]);

      const hBuf = await hRes.arrayBuffer();
      const tBuf = await tRes.arrayBuffer();
      const histBuf = await histRes.arrayBuffer();
      const lockBuf = await lockRes.arrayBuffer();

      const { territories: t, columns: tCols } = parseTerritories(tBuf);
      const { assignments: hist, columns: histCols } = parseHistoricalAssignments(histBuf);
      const { lockAssignments: lock, columns: lockCols } = parseLockAssignments(lockBuf);

      // 解析业务数据并与主数据 join
      setJoinStatus('正在加载 HCO 主数据...');
      const master = await loadHcoMaster();
      const { rows: bizRows, columns: hCols } = parseHospitalBusiness(hBuf);
      let h: Hospital[];
      const { hospitals: joined, skipped } = joinWithMaster(bizRows, master);

      if (joined.length > 0) {
        h = joined;
        const msg = [`已关联主数据，匹配 ${joined.length} 家`];
        if (skipped > 0) msg.push(`${skipped} 条未匹配`);
        setJoinStatus(msg.join('，'));

        // 补全缺失区县
        const missingDistrict = h.filter((hosp) => !hosp.district && hosp.longitude && hosp.latitude).length;
        if (missingDistrict > 0) await fillMissingDistricts(h);
      } else {
        // 回退到完整格式
        const { hospitals: parsed, columns: fullCols } = parseHospitals(hBuf);
        h = parsed;
        setJoinStatus('');
        const missingCount = h.filter((hosp) => !hosp.district && hosp.longitude && hosp.latitude).length;
        if (missingCount > 0) await fillMissingDistricts(h);
      }

      setHospitals(h);
      setHospitalFile(`测试数据 ${h.length} 家医院`);
      setHospitalColumns(hCols);

      setTerritories(t);
      setTerritoryFile(`测试数据 ${t.length} 个辖区`);
      setTerritoryColumns(tCols);

      setHistoricalAssignments(hist);
      setHistoricalFile(`测试数据 ${hist.length} 条记录`);
      setHistoricalColumns(histCols);

      setLockAssignments(lock);
      setLockFile(`测试数据 ${lock.length} 条锁定`);
      setLockColumns(lockCols);
    } catch (err) {
      console.error('加载测试数据失败:', err);
    } finally {
      setLoadingTest(false);
    }
  }, []);

  // 数据校验
  const validation: ValidationResult = useMemo(() => {
    if (hospitals.length === 0 && territories.length === 0) {
      return { errors: [], warnings: [] };
    }

    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    if (hospitals.length > 0) {
      const hv = validateHospitals(hospitals);
      allErrors.push(...hv.errors);
      allWarnings.push(...hv.warnings);
    }

    if (territories.length > 0) {
      const tv = validateTerritories(territories);
      allErrors.push(...tv.errors);
      allWarnings.push(...tv.warnings);
    }

    if (hospitals.length > 0 && territories.length > 0) {
      const cv = validateCrossTable(
        hospitals,
        territories,
        historicalAssignments.length > 0 ? historicalAssignments : undefined,
        lockAssignments.length > 0 ? lockAssignments : undefined
      );
      allErrors.push(...cv.errors);
      allWarnings.push(...cv.warnings);
    }

    return { errors: allErrors, warnings: allWarnings };
  }, [hospitals, territories, historicalAssignments, lockAssignments]);

  const hasData = hospitals.length > 0 && territories.length > 0;
  const canProceed = hasData && validation.errors.length === 0;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">数据上传</h2>
        <p className="text-gray-600 mb-3">上传医院业务数据、辖区清单及可选的历史分配和锁定清单</p>
        <div className="flex items-center justify-center gap-4 text-sm flex-wrap">
          <span className="text-gray-600">没有数据？下载示例文件：</span>
          <a href="/sample-hospitals.xlsx" download className="text-blue-500 hover:text-blue-700 underline">业务数据示例</a>
          <a href="/sample-territories.xlsx" download className="text-blue-500 hover:text-blue-700 underline">辖区清单示例</a>
          <a href="/sample-historical.xlsx" download className="text-blue-500 hover:text-blue-700 underline">历史分配示例</a>
          <a href="/sample-lock-assignments.xlsx" download className="text-blue-500 hover:text-blue-700 underline">锁定清单示例</a>
        </div>
        <button
          onClick={handleLoadTestData}
          disabled={loadingTest}
          className="mt-2 px-4 py-1.5 text-sm bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
        >
          {loadingTest ? '加载中...' : '一键加载测试数据'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Hospital Upload */}
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 hover:border-blue-400 transition-colors">
          <div className="text-center">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-1">医院业务数据</h3>
            <p className="text-xs text-gray-500 mb-3">必填 · inscode + 销量/潜力/index/产品组</p>

            {!hospitalFile ? (
              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">
                <Upload className="h-4 w-4" />
                选择文件
                <input type="file" accept=".xlsx,.xls" onChange={handleHospitalUpload} className="hidden" />
              </label>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <Check className="h-5 w-5" />
                  <span className="font-medium text-sm">{hospitalFile}</span>
                  <button onClick={() => { setHospitals([]); setHospitalFile(''); setHospitalColumns([]); setJoinStatus(''); }} className="ml-2 text-gray-400 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-sm text-gray-600">
                  已解析 <span className="font-bold text-blue-600">{hospitals.length}</span> 家医院
                </div>
                <div className="text-xs text-gray-500">识别列: {hospitalColumns.join(', ')}</div>
                {joinStatus && (
                  <div className="text-xs text-amber-600 mt-1">{joinStatus}</div>
                )}
              </div>
            )}
            {hospitalError && (
              <div className="mt-3 flex items-center gap-2 text-red-500 text-sm"><AlertCircle className="h-4 w-4" />{hospitalError}</div>
            )}
          </div>
        </div>

        {/* Territory Upload */}
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 hover:border-blue-400 transition-colors">
          <div className="text-center">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-purple-500 mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-1">辖区清单</h3>
            <p className="text-xs text-gray-500 mb-3">必填 · 含大区/LEL/产品组列</p>

            {!territoryFile ? (
              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">
                <Upload className="h-4 w-4" />
                选择文件
                <input type="file" accept=".xlsx,.xls" onChange={handleTerritoryUpload} className="hidden" />
              </label>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <Check className="h-5 w-5" />
                  <span className="font-medium text-sm">{territoryFile}</span>
                  <button onClick={() => { setTerritories([]); setTerritoryFile(''); setTerritoryColumns([]); }} className="ml-2 text-gray-400 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-sm text-gray-600">
                  已解析 <span className="font-bold text-purple-600">{territories.length}</span> 个辖区
                </div>
                <div className="text-xs text-gray-500">识别列: {territoryColumns.join(', ')}</div>
              </div>
            )}
            {territoryError && (
              <div className="mt-3 flex items-center gap-2 text-red-500 text-sm"><AlertCircle className="h-4 w-4" />{territoryError}</div>
            )}
          </div>
        </div>

        {/* Historical Assignment Upload (Optional) */}
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 hover:border-blue-400 transition-colors">
          <div className="text-center">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-amber-500 mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-1">历史分配</h3>
            <p className="text-xs text-gray-500 mb-3">可选 · 上季度分配结果</p>

            {!historicalFile ? (
              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">
                <Upload className="h-4 w-4" />
                选择文件
                <input type="file" accept=".xlsx,.xls" onChange={handleHistoricalUpload} className="hidden" />
              </label>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <Check className="h-5 w-5" />
                  <span className="font-medium text-sm">{historicalFile}</span>
                  <button onClick={() => { setHistoricalAssignments([]); setHistoricalFile(''); setHistoricalColumns([]); }} className="ml-2 text-gray-400 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-sm text-gray-600">
                  已解析 <span className="font-bold text-amber-600">{historicalAssignments.length}</span> 条历史分配
                </div>
                <div className="text-xs text-gray-500">识别列: {historicalColumns.join(', ')}</div>
              </div>
            )}
            {historicalError && (
              <div className="mt-3 flex items-center gap-2 text-red-500 text-sm"><AlertCircle className="h-4 w-4" />{historicalError}</div>
            )}
          </div>
        </div>

        {/* Lock Assignment Upload (Optional) */}
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 hover:border-red-400 transition-colors">
          <div className="text-center">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-1">锁定清单</h3>
            <p className="text-xs text-gray-500 mb-3">可选 · 医院锁定到指定LEL</p>

            {!lockFile ? (
              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors">
                <Upload className="h-4 w-4" />
                选择文件
                <input type="file" accept=".xlsx,.xls" onChange={handleLockUpload} className="hidden" />
              </label>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <Check className="h-5 w-5" />
                  <span className="font-medium text-sm">{lockFile}</span>
                  <button onClick={() => { setLockAssignments([]); setLockFile(''); setLockColumns([]); }} className="ml-2 text-gray-400 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-sm text-gray-600">
                  已解析 <span className="font-bold text-red-600">{lockAssignments.length}</span> 条锁定分配
                </div>
                <div className="text-xs text-gray-500">识别列: {lockColumns.join(', ')}</div>
              </div>
            )}
            {lockError && (
              <div className="mt-3 flex items-center gap-2 text-red-500 text-sm"><AlertCircle className="h-4 w-4" />{lockError}</div>
            )}
          </div>
        </div>
      </div>

      {/* Data Preview */}
      <DataPreview title="医院数据预览" columns={hospitalColumns} data={hospitals} fieldMap={HOSPITAL_FIELD_MAP} maxRows={5} />
      <DataPreview title="辖区数据预览" columns={territoryColumns} data={territories} fieldMap={TERRITORY_FIELD_MAP} maxRows={10} />
      <DataPreview title="历史分配预览" columns={historicalColumns} data={historicalAssignments} fieldMap={HISTORICAL_FIELD_MAP} maxRows={10} />
      <DataPreview title="锁定清单预览" columns={lockColumns} data={lockAssignments} fieldMap={LOCK_FIELD_MAP} maxRows={10} />

      {/* Validation Results */}
      {hasData && (validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="mb-6 space-y-3">
          {validation.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <span className="font-semibold text-red-700 text-sm">数据错误（需修复后才能继续）</span>
              </div>
              <ul className="space-y-1">
                {validation.errors.map((err, i) => (
                  <li key={i} className="text-sm text-red-600 flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">•</span>
                    <span>{err}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <span className="font-semibold text-amber-700 text-sm">数据警告（不影响继续，但可能影响结果）</span>
              </div>
              <ul className="space-y-1">
                {validation.warnings.map((warn, i) => (
                  <li key={i} className="text-sm text-amber-600 flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">•</span>
                    <span>{warn}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {hasData && validation.errors.length === 0 && validation.warnings.length === 0 && (
        <div className="mb-6">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span className="text-sm text-green-700 font-medium">数据校验通过</span>
          </div>
        </div>
      )}

      {/* Proceed Button */}
      <div className="text-center">
        <button
          onClick={() => onDataLoaded(
            hospitals,
            territories,
            historicalAssignments.length > 0 ? historicalAssignments : undefined,
            lockAssignments.length > 0 ? lockAssignments : undefined
          )}
          disabled={!canProceed}
          className={`px-8 py-3 rounded-xl font-semibold text-white transition-all ${
            canProceed
              ? 'bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-xl'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          下一步：设置约束条件
        </button>
      </div>
    </div>
  );
}
