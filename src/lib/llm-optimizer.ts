import { Hospital, Territory, Constraint, OptimizationResult, TerritoryResult, Assignment } from '@/types';

const BATCH_SIZE = 300;

interface LLMAssignment {
  hospitalId: string;
  territoryId: string;
  splitRatio: number;
}

export type ProgressCallback = (message: string, progress: number) => void;
export type StreamCallback = (chunk: string) => void;

function createBatches(hospitals: Hospital[]): Hospital[][] {
  if (hospitals.length <= BATCH_SIZE) return [hospitals];

  const byProvince = new Map<string, Hospital[]>();
  for (const h of hospitals) {
    const key = h.province || '未知';
    if (!byProvince.has(key)) byProvince.set(key, []);
    byProvince.get(key)!.push(h);
  }

  const batches: Hospital[][] = [];
  let currentBatch: Hospital[] = [];

  for (const [, provinceHospitals] of byProvince) {
    if (currentBatch.length + provinceHospitals.length > BATCH_SIZE && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
    }
    currentBatch.push(...provinceHospitals);
    if (currentBatch.length >= BATCH_SIZE) {
      batches.push(currentBatch);
      currentBatch = [];
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  return batches;
}

/**
 * Consume SSE stream from /api/assign-territory and accumulate full JSON text.
 */
async function assignBatchStreaming(
  hospitals: Hospital[],
  territories: Territory[],
  constraints: Constraint[],
  apiKey: string,
  batchIndex: number,
  totalBatches: number,
  onStream?: StreamCallback
): Promise<LLMAssignment[]> {
  const res = await fetch('/api/assign-territory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hospitals: hospitals.map((h) => ({
        id: h.id, inscode: h.inscode, insname: h.insname,
        city: h.city, province: h.province,
        latitude: h.latitude, longitude: h.longitude,
        index: h.index, sales: h.sales, potential: h.potential,
      })),
      territories: territories.map((t) => ({
        id: t.id, trtyCode: t.trtyCode, rep: t.rep,
      })),
      constraints: constraints.map((c) => ({
        type: c.type, description: c.description, priority: c.priority,
        weight: c.weight, value: c.value, value2: c.value2,
      })),
      apiKey,
      batchIndex: totalBatches > 1 ? batchIndex : undefined,
      totalBatches: totalBatches > 1 ? totalBatches : undefined,
    }),
  });

  // Check if response is SSE stream or regular JSON (error case)
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok || !contentType.includes('text/event-stream')) {
    // Non-streaming error response
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `API 错误 ${res.status}`);
  }

  // Read SSE stream
  const reader = res.body?.getReader();
  if (!reader) throw new Error('无响应体');

  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const data = JSON.parse(trimmed.slice(6));
          if (data.error) throw new Error(data.error);
          if (data.content) {
            fullContent += data.content;
            onStream?.(data.content);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
            // Re-throw real errors, skip parse errors from partial chunks
            if (!e.message.includes('JSON')) throw e;
          }
        }
      }
    }
  }

  reader.releaseLock();

  // Parse accumulated JSON
  let jsonStr = fullContent.trim();

  // Strip markdown code blocks
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  // Extract JSON object
  if (!jsonStr.startsWith('{')) {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) jsonStr = match[0];
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error('Failed to parse LLM response:', fullContent.slice(0, 500));
    throw new Error('模型返回格式异常，无法解析JSON');
  }

  if (!parsed.assignments || !Array.isArray(parsed.assignments)) {
    throw new Error('模型返回缺少 assignments 数组');
  }

  for (const a of parsed.assignments) {
    if (!a.hospitalId || !a.territoryId) {
      throw new Error('分配结果格式错误：缺少 hospitalId 或 territoryId');
    }
    if (a.splitRatio === undefined) a.splitRatio = 1.0;
  }

  return parsed.assignments;
}

function buildResult(
  assignments: LLMAssignment[],
  hospitals: Hospital[],
  territories: Territory[],
  constraints: Constraint[]
): OptimizationResult {
  const hospitalMap = new Map(hospitals.map((h) => [h.id, h]));
  const territoryMap = new Map(territories.map((t) => [t.id, t]));

  const trData = new Map<string, {
    assignments: Assignment[];
    hospitals: Hospital[];
    ratios: Map<string, number>;
  }>();

  for (const t of territories) {
    trData.set(t.id, { assignments: [], hospitals: [], ratios: new Map() });
  }

  for (const a of assignments) {
    const hospital = hospitalMap.get(a.hospitalId);
    const territory = territoryMap.get(a.territoryId);
    if (!hospital || !territory) continue;

    const td = trData.get(a.territoryId);
    if (!td) continue;

    td.assignments.push({
      hospitalId: a.hospitalId,
      hospitalName: hospital.insname,
      territoryId: a.territoryId,
      territoryName: territory.trtyCode,
      productGroup: hospital.productGroup || '',
      splitRatio: a.splitRatio < 1 ? a.splitRatio : undefined,
    });
    td.hospitals.push(hospital);
    td.ratios.set(hospital.id, a.splitRatio);
  }

  const territoryResults: TerritoryResult[] = territories.map((t) => {
    const td = trData.get(t.id)!;
    const cities = new Set<string>();
    td.hospitals.forEach((h) => { if (h.city) cities.add(h.city); });

    return {
      territory: t,
      hospitals: td.hospitals,
      assignments: td.assignments,
      totalIndex: td.hospitals.reduce((s, h) => s + h.index * (td.ratios.get(h.id) ?? 1), 0),
      totalSales: td.hospitals.reduce((s, h) => s + h.sales * (td.ratios.get(h.id) ?? 1), 0),
      totalPotential: td.hospitals.reduce((s, h) => s + h.potential * (td.ratios.get(h.id) ?? 1), 0),
      hospitalCount: td.hospitals.length,
      cityCount: cities.size,
    };
  });

  const { score, satisfied, details } = evaluateConstraints(territoryResults, constraints, hospitals);

  return {
    assignments: territoryResults.flatMap((tr) => tr.assignments),
    territoryResults,
    score,
    constraintsSatisfied: satisfied,
    constraintsTotal: constraints.length,
    details,
    productGroup: '',
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function evaluateConstraints(
  results: TerritoryResult[],
  constraints: Constraint[],
  hospitals: Hospital[]
): { score: number; satisfied: number; details: string[] } {
  let satisfied = 0;
  const details: string[] = [];

  for (const c of constraints) {
    let ok = false;

    switch (c.type) {
      case 'index_range': {
        const min = Number(c.value) || 800;
        const max = c.value2 ?? 1200;
        const bad = results.filter((r) => r.totalIndex < min || r.totalIndex > max);
        ok = bad.length === 0;
        details.push(ok
          ? `${c.description}: 满足`
          : `${c.description}: 未满足 (${bad.map((r) => `${r.territory.trtyCode}=${r.totalIndex.toFixed(1)}`).join(', ')})`
        );
        break;
      }
      case 'capacity': {
        const max = Number(c.value) || Infinity;
        const bad = results.filter((r) => r.hospitalCount > max);
        ok = bad.length === 0;
        details.push(ok
          ? `${c.description}: 满足`
          : `${c.description}: 未满足 (${bad.map((r) => `${r.territory.trtyCode}=${r.hospitalCount}家`).join(', ')})`
        );
        break;
      }
      case 'city_limit': {
        const max = Number(c.value) || Infinity;
        const bad = results.filter((r) => r.cityCount > max);
        ok = bad.length === 0;
        details.push(ok
          ? `${c.description}: 满足`
          : `${c.description}: 未满足 (${bad.map((r) => `${r.territory.trtyCode}=${r.cityCount}个城市`).join(', ')})`
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
      case 'geographic_distance': {
        const maxKm = Number(c.value) || 300;
        const violating: string[] = [];
        let worstDist = 0;
        let worstT = '';
        for (const r of results) {
          const hs = r.hospitals.filter((h) => h.latitude && h.longitude);
          let exceeds = false;
          for (let i = 0; i < hs.length && !exceeds; i++) {
            for (let j = i + 1; j < hs.length; j++) {
              const dist = haversineKm(hs[i].latitude, hs[i].longitude, hs[j].latitude, hs[j].longitude);
              if (dist > maxKm) {
                exceeds = true;
                if (dist > worstDist) { worstDist = dist; worstT = r.territory.trtyCode; }
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
          : `${c.description}: 未满足 (${violations.length}家医院拆分数量不符合规则)`
        );
        break;
      }
      default: {
        ok = true;
        details.push(`${c.description}: 已考虑`);
      }
    }

    if (ok) satisfied++;
  }

  const score = constraints.length > 0 ? (satisfied / constraints.length) * 100 : 100;
  return { score, satisfied, details };
}

/**
 * Main entry: LLM-based territory assignment with streaming and batch support.
 */
export async function optimizeWithLLM(
  hospitals: Hospital[],
  territories: Territory[],
  constraints: Constraint[],
  apiKey: string,
  onProgress?: ProgressCallback,
  onStream?: StreamCallback
): Promise<OptimizationResult> {
  const batches = createBatches(hospitals);
  const totalBatches = batches.length;
  const allAssignments: LLMAssignment[] = [];

  onProgress?.(`开始分配，共${hospitals.length}家医院，${totalBatches > 1 ? `分${totalBatches}批处理` : '单批处理'}`, 0);

  for (let i = 0; i < batches.length; i++) {
    onProgress?.(
      `正在处理第${i + 1}/${totalBatches}批（${batches[i].length}家医院）...`,
      ((i) / totalBatches) * 90
    );

    try {
      const batchResult = await assignBatchStreaming(
        batches[i], territories, constraints, apiKey,
        i, totalBatches, onStream
      );
      allAssignments.push(...batchResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      throw new Error(`第${i + 1}批处理失败: ${msg}`);
    }

    onProgress?.(
      `第${i + 1}/${totalBatches}批完成（已分配${allAssignments.length}条）`,
      ((i + 1) / totalBatches) * 90
    );
  }

  // Validate all hospitals assigned
  const assignedIds = new Set(allAssignments.map((a) => a.hospitalId));
  const missing = hospitals.filter((h) => !assignedIds.has(h.id));
  if (missing.length > 0) {
    onProgress?.(`补充分配${missing.length}家未覆盖医院...`, 92);
    const totals = new Map<string, number>();
    for (const t of territories) totals.set(t.id, 0);
    for (const a of allAssignments) {
      const h = hospitals.find((x) => x.id === a.hospitalId);
      if (h) totals.set(a.territoryId, (totals.get(a.territoryId) || 0) + h.index * a.splitRatio);
    }
    for (const h of missing) {
      let minT = territories[0].id;
      let minVal = Infinity;
      for (const [tId, val] of totals) {
        if (val < minVal) { minVal = val; minT = tId; }
      }
      allAssignments.push({ hospitalId: h.id, territoryId: minT, splitRatio: 1.0 });
      totals.set(minT, (totals.get(minT) || 0) + h.index);
    }
  }

  onProgress?.('正在生成结果...', 95);

  return buildResult(allAssignments, hospitals, territories, constraints);
}
