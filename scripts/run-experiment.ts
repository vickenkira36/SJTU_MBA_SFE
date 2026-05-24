// scripts/run-experiment.ts —— 第五章实证算法调用入口
// 用法：
//   npx tsx scripts/run-experiment.ts --dataset bc --province 上海市
//   npx tsx scripts/run-experiment.ts --dataset bc --province 湖北省
//   npx tsx scripts/run-experiment.ts --dataset lc --province 云南省

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import {
  Hospital,
  Territory,
  Constraint,
  HistoricalAssignment,
  OptimizationResult,
  AlgorithmMode,
} from '../src/types';
import { optimizeByProvince } from '../src/lib/optimizer';

// === CLI 参数 ===
const args = process.argv.slice(2);
function getArg(key: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${key}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const dataset = (getArg('dataset') || 'bc').toLowerCase();
const province = getArg('province'); // '上海市' / '湖北省' / '云南省'
const algorithmMode = (getArg('mode') || 'option2') as AlgorithmMode;
const provinceTag = province ? province.replace('市', '').replace('省', '') : 'all';
const outputDir = getArg('output-dir') || `data/case/output/${dataset}-${provinceTag}`;

// === xlsx 读取工具 ===
function readSheet<T = Record<string, unknown>>(p: string): T[] {
  const wb = XLSX.readFile(p);
  return XLSX.utils.sheet_to_json<T>(wb.Sheets[wb.SheetNames[0]]);
}

// === hco-master 索引：inscode → 元数据（含经纬度）===
type HcoRecord = {
  inscode: string;
  insname: string;
  区县?: string;
  城市?: string;
  省份?: string;
  纬度?: number;
  经度?: number;
};
function loadHcoMaster(p: string): Map<string, HcoRecord> {
  const rows = readSheet<HcoRecord>(p);
  return new Map(rows.map((r) => [r.inscode, r]));
}

// === 中文 xlsx → Hospital[] 映射 ===
function loadHospitals(p: string, hco: Map<string, HcoRecord>): Hospital[] {
  type Row = {
    inscode: string;
    insname: string;
    省份?: string;
    销量?: number;
    潜力?: number;
    销量归一化?: number;
    潜力归一化?: number;
    index?: number;
    产品组?: string;
  };
  const rows = readSheet<Row>(p);
  return rows.map((r, idx) => {
    const meta = hco.get(r.inscode) || {} as HcoRecord;
    return {
      id: `H_${idx}_${r.inscode}`,
      inscode: r.inscode,
      insname: r.insname || meta.insname || '',
      district: meta.区县 || '',
      city: meta.城市 || '',
      province: r.省份 || meta.省份 || '',
      latitude: typeof meta.纬度 === 'number' ? meta.纬度 : 0,
      longitude: typeof meta.经度 === 'number' ? meta.经度 : 0,
      sales: r.销量 || 0,
      potential: r.潜力 || 0,
      salesNorm: r.销量归一化 || 0,
      potentialNorm: r.潜力归一化 || 0,
      index: r.index || 0,
      productGroup: r.产品组 || '',
    } as Hospital;
  });
}

function loadTerritories(p: string): Territory[] {
  type Row = {
    TRTY_CODE: string;
    Rep?: string;
    省份?: string;
    大区?: string;
    LEL?: string;
    产品组?: string;
  };
  const rows = readSheet<Row>(p);
  return rows.map((r, idx) => ({
    id: `T_${idx}_${r.TRTY_CODE}`,
    trtyCode: r.TRTY_CODE,
    rep: r.Rep || '',
    province: r.省份 || '',
    region: r.大区 || '',
    lel: r.LEL || '',
    productGroup: r.产品组 || '',
  } as Territory));
}

function loadHistorical(p: string): HistoricalAssignment[] {
  type Row = {
    inscode: string;
    TRTY_CODE: string;
    产品组?: string;
    比例?: number;
  };
  const rows = readSheet<Row>(p);
  return rows.map((r) => ({
    inscode: r.inscode,
    trtyCode: r.TRTY_CODE,
    productGroup: r.产品组 || '',
    portion: r.比例 != null ? r.比例 : 1,
  }));
}

// === 默认约束（对应 4.3 节软约束体系）===
function defaultConstraints(): Constraint[] {
  return [
    {
      id: 'idx_range',
      description: 'Index 偏差软约束（阈值 200）',
      type: 'index_range',
      priority: 'soft',
      threshold: 200,
      valid: true,
    },
    {
      id: 'capacity',
      description: '单辖区医院数软约束',
      type: 'capacity',
      priority: 'soft',
      threshold: 1,
      valid: true,
    },
    {
      id: 'city_limit',
      description: '单辖区城市数软约束（c_max=5）',
      type: 'city_limit',
      priority: 'soft',
      threshold: 1,
      value: 5,
      valid: true,
    },
    {
      id: 'distance',
      description: '辖区地理跨度',
      type: 'geographic_distance',
      priority: 'soft',
      threshold: 10,
      valid: true,
    },
    {
      id: 'district',
      description: '区县集中度',
      type: 'district_concentration',
      priority: 'soft',
      threshold: 1,
      valid: true,
    },
    {
      id: 'split',
      description: '大医院拆分阈值（1.5x 理想值）',
      type: 'hospital_split',
      priority: 'soft',
      value: 1.5,
      valid: true,
    },
  ];
}

// === Main ===
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`实证运行：${dataset.toUpperCase()} 数据集，省份过滤=${province || '全国'}`);
  console.log(`算法模式：${algorithmMode}`);
  console.log(`输出目录：${outputDir}`);
  console.log('='.repeat(60));

  console.log('→ 加载 hco-master.xlsx（元数据）...');
  const hco = loadHcoMaster('data/case/hco-master.xlsx');
  console.log(`  ${hco.size} 条记录`);

  console.log(`→ 加载 ${dataset.toUpperCase()} 业务数据 ...`);
  let hospitals = loadHospitals(`data/case/${dataset}/hospitals.xlsx`, hco);
  let territories = loadTerritories(`data/case/${dataset}/territories.xlsx`);
  let historical = loadHistorical(`data/case/${dataset}/historical.xlsx`);
  console.log(`  全国: hospitals=${hospitals.length}, territories=${territories.length}, historical=${historical.length}`);

  // 省份过滤
  if (province) {
    hospitals = hospitals.filter((h) => h.province === province);
    territories = territories.filter((t) => t.province === province);
    const hSet = new Set(hospitals.map((h) => h.inscode));
    historical = historical.filter((ha) => hSet.has(ha.inscode));
    // 还要 filter 历史里指向不在本省 territories 的条目（跨省历史关联）
    const tSet = new Set(territories.map((t) => t.trtyCode));
    historical = historical.filter((ha) => tSet.has(ha.trtyCode));
    console.log(`  ${province} 过滤后: hospitals=${hospitals.length}, territories=${territories.length}, historical=${historical.length}`);
  }

  // 经纬度缺失检查
  const noCoord = hospitals.filter((h) => !h.latitude || !h.longitude).length;
  if (noCoord > 0) {
    console.log(`  ⚠ ${noCoord} 家医院缺经纬度（hco-master 未关联到）`);
  }

  // 调用算法
  console.log(`\n→ 调用 optimizeByProvince(mode=${algorithmMode}) ...`);
  const startTime = Date.now();
  const result: OptimizationResult = optimizeByProvince(
    hospitals,
    territories,
    defaultConstraints(),
    (cur, tot, prov) => {
      if (cur === tot) console.log(`  ✓ ${prov} (${cur}/${tot})`);
    },
    historical,
    [],
    [],
    algorithmMode,
  );
  const elapsedSec = (Date.now() - startTime) / 1000;

  console.log(`\n→ 算法完成，耗时 ${elapsedSec.toFixed(1)}s`);
  console.log(`  score: ${result.score.toFixed(0)}`);
  console.log(`  约束满足：${result.constraintsSatisfied}/${result.constraintsTotal}`);
  console.log(`  分配条数：${result.assignments.length}`);
  if (result.changeRate) {
    console.log(`  与历史变动率：${(result.changeRate.rate * 100).toFixed(1)}% (${result.changeRate.changed}/${result.changeRate.total})`);
  }

  // 写入输出
  fs.mkdirSync(outputDir, { recursive: true });
  const resultJson = {
    meta: {
      dataset,
      province: province || 'all',
      algorithmMode,
      elapsedSec,
      hospitalsCount: hospitals.length,
      territoriesCount: territories.length,
      historicalCount: historical.length,
      timestamp: new Date().toISOString(),
    },
    score: result.score,
    constraintsSatisfied: result.constraintsSatisfied,
    constraintsTotal: result.constraintsTotal,
    changeRate: result.changeRate,
    territoryResults: result.territoryResults.map((tr) => ({
      trtyCode: tr.territory.trtyCode,
      rep: tr.territory.rep,
      province: tr.territory.province,
      productGroup: tr.territory.productGroup,
      hospitalCount: tr.hospitalCount,
      cityCount: tr.cityCount,
      totalIndex: tr.totalIndex,
      totalSales: tr.totalSales,
      totalPotential: tr.totalPotential,
      hospitals: tr.hospitals.map((h) => ({
        inscode: h.inscode,
        city: h.city,
        district: h.district,
        index: h.index,
        latitude: h.latitude,
        longitude: h.longitude,
      })),
    })),
    assignments: result.assignments,
  };
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(resultJson, null, 2));
  console.log(`→ 输出：${outputDir}/result.json`);

  // 也存一份 As-Is（用 historical 作为基线）
  fs.writeFileSync(
    path.join(outputDir, 'as-is.json'),
    JSON.stringify({ historical, hospitalsCount: hospitals.length, territoriesCount: territories.length }, null, 2),
  );
  console.log(`→ 输出：${outputDir}/as-is.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
