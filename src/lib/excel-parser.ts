import * as XLSX from 'xlsx';
import { Hospital, Territory, LockAssignment, HistoricalAssignment } from '@/types';

const HOSPITAL_FIELD_MAP: Record<string, string> = {
  'inscode': 'inscode',
  'insname': 'insname',
  '区县': 'district',
  '区': 'district',
  'district': 'district',
  '城市': 'city',
  '省份': 'province',
  '销量': 'sales',
  '潜力': 'potential',
  '销量归一化': 'salesNorm',
  '潜力归一化': 'potentialNorm',
  'index': 'index',
  '纬度': 'latitude',
  '经度': 'longitude',
  'latitude': 'latitude',
  'longitude': 'longitude',
  'lat': 'latitude',
  'lng': 'longitude',
  'lon': 'longitude',
  '产品组': 'productGroup',
  'productGroup': 'productGroup',
  'product_group': 'productGroup',
  '产品': 'productGroup',
  // Fallback aliases
  '医院代码': 'inscode',
  '医院名称': 'insname',
  '名称': 'insname',
  '城市名': 'city',
  '市': 'city',
  '省': 'province',
};

const TERRITORY_FIELD_MAP: Record<string, string> = {
  'TRTY_CODE': 'trtyCode',
  'Rep': 'rep',
  '省份': 'province',
  '省': 'province',
  'province': 'province',
  '大区': 'region',
  'region': 'region',
  '区域': 'region',
  'LEL': 'lel',
  'lel': 'lel',
  '地区经理': 'lel',
  '产品组': 'productGroup',
  'productGroup': 'productGroup',
  'product_group': 'productGroup',
  '产品': 'productGroup',
  // Fallback aliases
  '辖区代码': 'trtyCode',
  '辖区名称': 'trtyCode',
  '代表': 'rep',
  'SFE': 'rep',
};

function mapColumns<T>(row: Record<string, unknown>, fieldMap: Record<string, string>): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const trimmedKey = key.trim();
    const mappedField = fieldMap[trimmedKey] || trimmedKey;
    result[mappedField] = value;
  }
  return result as Partial<T>;
}

export function parseHospitals(file: ArrayBuffer): { hospitals: Hospital[]; columns: string[] } {
  const workbook = XLSX.read(file, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  if (rawData.length === 0) {
    throw new Error('医院清单为空');
  }

  const columns = Object.keys(rawData[0]);

  const hospitals: Hospital[] = rawData.map((row, idx) => {
    const mapped = mapColumns<Hospital>(row, HOSPITAL_FIELD_MAP);
    return {
      id: `H${String(idx + 1).padStart(3, '0')}`,
      inscode: String(mapped.inscode || ''),
      insname: String(mapped.insname || `医院${idx + 1}`),
      district: String(mapped.district || ''),
      city: String(mapped.city || ''),
      province: String(mapped.province || ''),
      latitude: Number(mapped.latitude) || 0,
      longitude: Number(mapped.longitude) || 0,
      sales: Number(mapped.sales) || 0,
      potential: Number(mapped.potential) || 0,
      salesNorm: Number(mapped.salesNorm) || 0,
      potentialNorm: Number(mapped.potentialNorm) || 0,
      index: Number(mapped.index) || 0,
      productGroup: String(mapped.productGroup || ''),
      ...Object.fromEntries(
        Object.entries(mapped).filter(
          ([k]) => !['id', 'inscode', 'insname', 'district', 'city', 'province', 'latitude', 'longitude', 'sales', 'potential', 'salesNorm', 'potentialNorm', 'index', 'productGroup'].includes(k)
        )
      ),
    };
  });

  return { hospitals, columns };
}

// ============================================================
// HCO 主数据：加载 + 业务数据解析 + join
// ============================================================

interface HcoMasterRecord {
  inscode: string;
  insname: string;
  district: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
}

const HCO_MASTER_FIELD_MAP: Record<string, string> = {
  'inscode': 'inscode',
  'insname': 'insname',
  '区县': 'district',
  '城市': 'city',
  '省份': 'province',
  '纬度': 'latitude',
  '经度': 'longitude',
  '医院代码': 'inscode',
  '医院名称': 'insname',
};

const BUSINESS_FIELD_MAP: Record<string, string> = {
  'inscode': 'inscode',
  '医院代码': 'inscode',
  '销量': 'sales',
  '潜力': 'potential',
  '销量归一化': 'salesNorm',
  '潜力归一化': 'potentialNorm',
  'index': 'index',
  '产品组': 'productGroup',
  'productGroup': 'productGroup',
  'product_group': 'productGroup',
  '产品': 'productGroup',
};

let cachedMaster: Map<string, HcoMasterRecord> | null = null;

/** 加载 HCO 主数据（从 /hco-master.xlsx），结果缓存 */
export async function loadHcoMaster(): Promise<Map<string, HcoMasterRecord>> {
  if (cachedMaster) return cachedMaster;

  const res = await fetch('/hco-master.xlsx');
  if (!res.ok) throw new Error('无法加载 HCO 主数据文件');
  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  const master = new Map<string, HcoMasterRecord>();
  for (const row of rawData) {
    const mapped = mapColumns<HcoMasterRecord>(row, HCO_MASTER_FIELD_MAP);
    const inscode = String(mapped.inscode || '').toUpperCase();
    if (!inscode) continue;
    master.set(inscode, {
      inscode: String(mapped.inscode || ''),
      insname: String(mapped.insname || ''),
      district: String(mapped.district || ''),
      city: String(mapped.city || ''),
      province: String(mapped.province || ''),
      latitude: Number(mapped.latitude) || 0,
      longitude: Number(mapped.longitude) || 0,
    });
  }

  cachedMaster = master;
  return master;
}

/** 解析业务数据 Excel（仅含 inscode + 销量/潜力/index/产品组） */
export function parseHospitalBusiness(file: ArrayBuffer): {
  rows: { inscode: string; sales: number; potential: number; salesNorm: number; potentialNorm: number; index: number; productGroup: string }[];
  columns: string[];
} {
  const wb = XLSX.read(file, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  if (rawData.length === 0) throw new Error('业务数据为空');

  const columns = Object.keys(rawData[0]);
  const rows = rawData.map((row) => {
    const mapped = mapColumns<Record<string, unknown>>(row, BUSINESS_FIELD_MAP);
    return {
      inscode: String(mapped.inscode || ''),
      sales: Number(mapped.sales) || 0,
      potential: Number(mapped.potential) || 0,
      salesNorm: Number(mapped.salesNorm) || 0,
      potentialNorm: Number(mapped.potentialNorm) || 0,
      index: Number(mapped.index) || 0,
      productGroup: String(mapped.productGroup || ''),
    };
  });

  return { rows, columns };
}

/** 将业务数据与 HCO 主数据 join，返回完整 Hospital[]。inscode 匹配不上的跳过。 */
export function joinWithMaster(
  businessRows: { inscode: string; sales: number; potential: number; salesNorm: number; potentialNorm: number; index: number; productGroup: string }[],
  master: Map<string, HcoMasterRecord>
): { hospitals: Hospital[]; skipped: number } {
  const hospitals: Hospital[] = [];
  let skipped = 0;

  for (let idx = 0; idx < businessRows.length; idx++) {
    const biz = businessRows[idx];
    const key = biz.inscode.toUpperCase();
    const m = master.get(key);
    if (!m) {
      skipped++;
      continue;
    }
    hospitals.push({
      id: `H${String(hospitals.length + 1).padStart(3, '0')}`,
      inscode: m.inscode,
      insname: m.insname,
      district: m.district,
      city: m.city,
      province: m.province,
      latitude: m.latitude,
      longitude: m.longitude,
      sales: biz.sales,
      potential: biz.potential,
      salesNorm: biz.salesNorm,
      potentialNorm: biz.potentialNorm,
      index: biz.index,
      productGroup: biz.productGroup,
    });
  }

  return { hospitals, skipped };
}

export function parseTerritories(file: ArrayBuffer): { territories: Territory[]; columns: string[] } {
  const workbook = XLSX.read(file, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  if (rawData.length === 0) {
    throw new Error('辖区清单为空');
  }

  const columns = Object.keys(rawData[0]);

  const territories: Territory[] = rawData.map((row, idx) => {
    const mapped = mapColumns<Territory>(row, TERRITORY_FIELD_MAP);
    return {
      id: `T${String(idx + 1).padStart(3, '0')}`,
      trtyCode: String(mapped.trtyCode || `T${idx + 1}`),
      rep: String(mapped.rep || ''),
      province: String(mapped.province || ''),
      region: String(mapped.region || ''),
      lel: String(mapped.lel || ''),
      productGroup: String(mapped.productGroup || ''),
      ...Object.fromEntries(
        Object.entries(mapped).filter(
          ([k]) => !['id', 'trtyCode', 'rep', 'province', 'region', 'lel', 'productGroup'].includes(k)
        )
      ),
    };
  });

  return { territories, columns };
}

export function parseHistoricalAssignments(file: ArrayBuffer): { assignments: import('@/types').HistoricalAssignment[]; columns: string[] } {
  const workbook = XLSX.read(file, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  if (rawData.length === 0) {
    throw new Error('历史分配清单为空');
  }

  const columns = Object.keys(rawData[0]);

  const fieldMap: Record<string, string> = {
    'inscode': 'inscode',
    '医院代码': 'inscode',
    'TRTY_CODE': 'trtyCode',
    '辖区代码': 'trtyCode',
    '辖区': 'trtyCode',
    '产品组': 'productGroup',
    'productGroup': 'productGroup',
    'product_group': 'productGroup',
    '产品': 'productGroup',
    '比例': 'portion',
    'portion': 'portion',
    'ratio': 'portion',
    '占比': 'portion',
  };

  const assignments = rawData.map((row) => {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const trimmedKey = key.trim();
      const mappedField = fieldMap[trimmedKey] || trimmedKey;
      mapped[mappedField] = value;
    }
    const portionVal = mapped.portion !== undefined ? Number(mapped.portion) : undefined;
    return {
      inscode: String(mapped.inscode || ''),
      trtyCode: String(mapped.trtyCode || ''),
      productGroup: String(mapped.productGroup || ''),
      portion: portionVal !== undefined && !isNaN(portionVal) ? portionVal : undefined,
    };
  }).filter((a) => a.inscode && a.trtyCode);

  return { assignments, columns };
}

export function parseLockAssignments(file: ArrayBuffer): { lockAssignments: LockAssignment[]; columns: string[] } {
  const workbook = XLSX.read(file, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  if (rawData.length === 0) {
    throw new Error('锁定清单为空');
  }

  const columns = Object.keys(rawData[0]);

  const fieldMap: Record<string, string> = {
    'inscode': 'inscode',
    '医院代码': 'inscode',
    'LEL': 'lel',
    'lel': 'lel',
    '地区经理': 'lel',
    '产品组': 'productGroup',
    'productGroup': 'productGroup',
    'product_group': 'productGroup',
    '产品': 'productGroup',
  };

  const lockAssignments = rawData.map((row) => {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const trimmedKey = key.trim();
      const mappedField = fieldMap[trimmedKey] || trimmedKey;
      mapped[mappedField] = value;
    }
    return {
      inscode: String(mapped.inscode || ''),
      lel: String(mapped.lel || ''),
      productGroup: String(mapped.productGroup || ''),
    };
  }).filter((a) => a.inscode && a.lel);

  return { lockAssignments, columns };
}

export function getAvailableFields(hospitals: Hospital[], territories: Territory[]): string[] {
  const fields = new Set<string>();

  if (hospitals.length > 0) {
    Object.keys(hospitals[0]).forEach((k) => fields.add(k));
  }
  if (territories.length > 0) {
    Object.keys(territories[0]).forEach((k) => fields.add(`territory.${k}`));
  }

  return Array.from(fields);
}

// ============================================================
// 数据校验
// ============================================================

export interface ValidationResult {
  errors: string[];   // 阻断性错误
  warnings: string[]; // 非阻断性警告
}

/** 校验医院数据列完整性 */
export function validateHospitals(hospitals: Hospital[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (hospitals.length === 0) {
    errors.push('医院清单为空');
    return { errors, warnings };
  }

  // 必需字段
  const missingInscode = hospitals.filter((h) => !h.inscode);
  if (missingInscode.length > 0) {
    errors.push(`${missingInscode.length} 家医院缺少 inscode`);
  }

  const missingProvince = hospitals.filter((h) => !h.province);
  if (missingProvince.length > 0) {
    errors.push(`${missingProvince.length} 家医院缺少省份`);
  }

  const missingIndex = hospitals.filter((h) => !h.index || h.index <= 0);
  if (missingIndex.length > 0) {
    warnings.push(`${missingIndex.length} 家医院 index 为 0 或缺失`);
  }

  const missingCoords = hospitals.filter((h) => !h.latitude || !h.longitude);
  if (missingCoords.length > 0) {
    warnings.push(`${missingCoords.length} 家医院缺少经纬度，地图和距离约束将不准确`);
  }

  const missingPG = hospitals.filter((h) => !h.productGroup);
  if (missingPG.length > 0 && missingPG.length < hospitals.length) {
    warnings.push(`${missingPG.length} 家医院缺少产品组`);
  }

  // 重复 inscode 检查
  const inscodeCount = new Map<string, number>();
  for (const h of hospitals) {
    if (h.inscode) inscodeCount.set(h.inscode, (inscodeCount.get(h.inscode) || 0) + 1);
  }
  const duplicates = Array.from(inscodeCount.entries()).filter(([, c]) => c > 1);
  if (duplicates.length > 0) {
    // 有产品组时同一 inscode 可出现多次（不同产品组），否则是重复
    const hasPG = hospitals.some((h) => h.productGroup);
    if (!hasPG) {
      warnings.push(`${duplicates.length} 个 inscode 重复出现：${duplicates.slice(0, 5).map(([k, c]) => `${k}(${c}次)`).join(', ')}${duplicates.length > 5 ? '...' : ''}`);
    }
  }

  return { errors, warnings };
}

/** 校验辖区数据列完整性 */
export function validateTerritories(territories: Territory[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (territories.length === 0) {
    errors.push('辖区清单为空');
    return { errors, warnings };
  }

  const missingCode = territories.filter((t) => !t.trtyCode);
  if (missingCode.length > 0) {
    errors.push(`${missingCode.length} 个辖区缺少 TRTY_CODE`);
  }

  const missingProvince = territories.filter((t) => !t.province);
  if (missingProvince.length > 0) {
    errors.push(`${missingProvince.length} 个辖区缺少省份`);
  }

  const missingRegion = territories.filter((t) => !t.region);
  if (missingRegion.length > 0 && missingRegion.length < territories.length) {
    warnings.push(`${missingRegion.length} 个辖区缺少大区，大区约束参数将不可用`);
  } else if (missingRegion.length === territories.length) {
    warnings.push('所有辖区均缺少大区列，将使用全局约束参数');
  }

  const missingLel = territories.filter((t) => !t.lel);
  if (missingLel.length > 0 && missingLel.length < territories.length) {
    warnings.push(`${missingLel.length} 个辖区缺少 LEL`);
  }

  const missingPG = territories.filter((t) => !t.productGroup);
  if (missingPG.length > 0 && missingPG.length < territories.length) {
    warnings.push(`${missingPG.length} 个辖区缺少产品组`);
  }

  return { errors, warnings };
}

/** 校验表间关联性 */
export function validateCrossTable(
  hospitals: Hospital[],
  territories: Territory[],
  historicalAssignments?: HistoricalAssignment[],
  lockAssignments?: LockAssignment[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 省份匹配：医院省份是否都能在辖区中找到
  const territoryProvinces = new Set(territories.map((t) => t.province).filter(Boolean));
  const hospitalProvinces = new Set(hospitals.map((h) => h.province).filter(Boolean));
  const orphanProvinces = Array.from(hospitalProvinces).filter((p) => !territoryProvinces.has(p));
  if (orphanProvinces.length > 0) {
    const orphanCount = hospitals.filter((h) => orphanProvinces.includes(h.province)).length;
    warnings.push(`${orphanCount} 家医院所在省份（${orphanProvinces.join('、')}）在辖区表中不存在，这些医院将无法分配`);
  }

  // 反向：辖区省份没有对应医院
  const emptyProvinces = Array.from(territoryProvinces).filter((p) => !hospitalProvinces.has(p));
  if (emptyProvinces.length > 0) {
    warnings.push(`辖区省份（${emptyProvinces.join('、')}）没有对应的医院数据`);
  }

  // 2. 产品组匹配
  const hospitalPGs = new Set(hospitals.map((h) => h.productGroup).filter(Boolean));
  const territoryPGs = new Set(territories.map((t) => t.productGroup).filter(Boolean));
  if (hospitalPGs.size > 0 && territoryPGs.size > 0) {
    const orphanHPGs = Array.from(hospitalPGs).filter((pg) => !territoryPGs.has(pg));
    if (orphanHPGs.length > 0) {
      warnings.push(`医院产品组（${orphanHPGs.join('、')}）在辖区表中不存在`);
    }
    const orphanTPGs = Array.from(territoryPGs).filter((pg) => !hospitalPGs.has(pg));
    if (orphanTPGs.length > 0) {
      warnings.push(`辖区产品组（${orphanTPGs.join('、')}）没有对应的医院数据`);
    }
  } else if (hospitalPGs.size > 0 && territoryPGs.size === 0) {
    warnings.push('医院表有产品组列但辖区表没有，产品组维度将被忽略');
  } else if (hospitalPGs.size === 0 && territoryPGs.size > 0) {
    warnings.push('辖区表有产品组列但医院表没有，产品组维度将被忽略');
  }

  // 3. 历史分配校验
  if (historicalAssignments && historicalAssignments.length > 0) {
    const hospitalInscodes = new Set(hospitals.map((h) => h.inscode));
    const territoryCodes = new Set(territories.map((t) => t.trtyCode));

    const unmatchedInscode = historicalAssignments.filter((ha) => !hospitalInscodes.has(ha.inscode));
    if (unmatchedInscode.length > 0) {
      warnings.push(`历史分配中 ${unmatchedInscode.length} 条 inscode 在医院表中不存在（${unmatchedInscode.slice(0, 3).map((h) => h.inscode).join('、')}${unmatchedInscode.length > 3 ? '...' : ''}）`);
    }

    const unmatchedTrty = historicalAssignments.filter((ha) => !territoryCodes.has(ha.trtyCode));
    if (unmatchedTrty.length > 0) {
      warnings.push(`历史分配中 ${unmatchedTrty.length} 条 TRTY_CODE 在辖区表中不存在（${unmatchedTrty.slice(0, 3).map((h) => h.trtyCode).join('、')}${unmatchedTrty.length > 3 ? '...' : ''}）`);
    }

    const matchRate = historicalAssignments.filter((ha) => hospitalInscodes.has(ha.inscode) && territoryCodes.has(ha.trtyCode)).length;
    if (matchRate === 0 && historicalAssignments.length > 0) {
      errors.push('历史分配数据与医院/辖区表完全不匹配，请检查数据来源');
    }
  }

  // 4. 锁定清单校验
  if (lockAssignments && lockAssignments.length > 0) {
    const hospitalInscodes = new Set(hospitals.map((h) => h.inscode));
    const territoryLels = new Set(territories.map((t) => t.lel).filter(Boolean));

    const unmatchedInscode = lockAssignments.filter((la) => !hospitalInscodes.has(la.inscode));
    if (unmatchedInscode.length > 0) {
      warnings.push(`锁定清单中 ${unmatchedInscode.length} 条 inscode 在医院表中不存在（${unmatchedInscode.slice(0, 3).map((l) => l.inscode).join('、')}${unmatchedInscode.length > 3 ? '...' : ''}）`);
    }

    const unmatchedLel = lockAssignments.filter((la) => !territoryLels.has(la.lel));
    if (unmatchedLel.length > 0) {
      const uniqueLels = Array.from(new Set(unmatchedLel.map((l) => l.lel)));
      errors.push(`锁定清单中 LEL（${uniqueLels.slice(0, 3).join('、')}${uniqueLels.length > 3 ? '...' : ''}）在辖区表中不存在，锁定约束将无法生效`);
    }

    if (territoryLels.size === 0 && lockAssignments.length > 0) {
      errors.push('辖区表缺少 LEL 列，无法使用锁定清单');
    }

    const matchRate = lockAssignments.filter((la) => hospitalInscodes.has(la.inscode) && territoryLels.has(la.lel)).length;
    if (matchRate === 0 && lockAssignments.length > 0) {
      errors.push('锁定清单与医院/辖区表完全不匹配，请检查数据来源');
    }
  }

  return { errors, warnings };
}

// ============================================================
// 高德逆地理编码：补全缺失的区县字段
// ============================================================

const AMAP_KEY = '607c50ad475045563bcdb62971f90f59';

interface AmapRegeoResponse {
  status: string;
  regeocode: {
    addressComponent: {
      district: string;
    };
  };
}

/** 对区县为空且有经纬度的医院，调用高德逆地理编码补全 district 字段。返回补全数量。 */
export async function fillMissingDistricts(
  hospitals: Hospital[],
  onProgress?: (filled: number, total: number) => void
): Promise<number> {
  const missing = hospitals.filter((h) => !h.district && h.longitude && h.latitude);
  if (missing.length === 0) return 0;

  let filled = 0;
  const batchSize = 20;

  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(async (h) => {
        const location = `${h.longitude},${h.latitude}`;
        const url = `https://restapi.amap.com/v3/geocode/regeo?location=${location}&key=${AMAP_KEY}&extensions=base`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data: AmapRegeoResponse = await res.json();
        if (data.status === '1' && data.regeocode?.addressComponent?.district) {
          return { hospital: h, district: data.regeocode.addressComponent.district };
        }
        return null;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        r.value.hospital.district = r.value.district;
        filled++;
      }
    }

    onProgress?.(filled, missing.length);
  }

  return filled;
}


