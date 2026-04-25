export interface Hospital {
  id: string;
  inscode: string;
  insname: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
  sales: number;
  potential: number;
  salesNorm: number;
  potentialNorm: number;
  index: number;
  productGroup: string;
  [key: string]: string | number | undefined;
}

export interface Territory {
  id: string;
  trtyCode: string;
  rep: string;
  province: string;
  region: string;
  lel: string;
  productGroup: string;
  [key: string]: string | number | undefined;
}

export interface Constraint {
  id: string;
  description: string;
  type: ConstraintType;
  field?: string;
  operator?: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'between';
  value?: string | number;
  value2?: number;
  territoryField?: string;
  priority: 'hard' | 'soft';
  weight?: number; // deprecated — kept for backward compat, use threshold instead
  // Threshold: how much violation equals "1 unit of penalty"
  // e.g. index_range threshold=200 means exceeding range by 200 = 1 penalty unit
  threshold?: number;
  valid: boolean;
  validationMessage?: string;
}

export type ConstraintType =
  | 'balance'              // 医院数量均衡
  | 'index_range'          // index总值范围
  | 'hospital_split'       // 大index医院按比例拆分到多个辖区
  | 'split_count'          // 每家医院分配的辖区数量范围(min-max)
  | 'split_ratio_sum'      // 拆分比例加和为100%
  | 'city_limit'           // 单个辖区城市数量上限
  | 'capacity'             // 单个辖区医院家数上限
  | 'geographic'           // 同城市/同省份分到同一辖区
  | 'geographic_distance'  // 同辖区内医院间最大距离(km)
  | 'assignment'           // 指定分配
  | 'grouping'             // 分组约束
  | 'exclusion'            // 互斥约束
  | 'sales'                // 销量均衡
  | 'potential'            // 潜力均衡
  | 'historical_stability' // 历史分配稳定性
  | 'custom';

export interface HistoricalAssignment {
  inscode: string;
  trtyCode: string;
  productGroup: string;
}

export interface LockAssignment {
  inscode: string;
  lel: string;
  productGroup: string;
}

export interface RegionConstraintParams {
  region: string;
  productGroup: string;
  indexMin: number;
  indexMax: number;
  capacityMax: number;
  cityLimitMax: number;
  maxDistanceKm: number;
  splitThreshold: number;
  // Thresholds: how much violation = 1 penalty unit (same as Constraint.threshold)
  indexThreshold: number;        // index 超出范围多少 = 1份惩罚 (default 200)
  capacityThreshold: number;     // 医院数超出多少 = 1份惩罚 (default 1)
  cityThreshold: number;         // 城市数超出多少 = 1份惩罚 (default 1)
  distanceThreshold: number;     // 距离超出多少km = 1份惩罚 (default 10)
  historicalThreshold: number;   // 历史变动index多少 = 1份惩罚 (default 200)
}

export interface PresetConstraint extends Constraint {
  isPreset: true;
  editable: boolean; // 软约束的数值可编辑
}

export interface Assignment {
  hospitalId: string;
  hospitalName: string;
  territoryId: string;
  territoryName: string;
  productGroup: string;
  splitRatio?: number; // 拆分比例，1.0 表示100%分配
}

export interface TerritoryResult {
  territory: Territory;
  hospitals: Hospital[];
  assignments: Assignment[]; // 包含拆分信息的分配
  totalIndex: number;
  totalSales: number;
  totalPotential: number;
  hospitalCount: number;
  cityCount: number;
}

export interface ProvinceConstraintDetail {
  province: string;
  constraint: string;
  satisfied: boolean;
  detail: string;
}

export interface OptimizationResult {
  assignments: Assignment[];
  territoryResults: TerritoryResult[];
  score: number;
  constraintsSatisfied: number;
  constraintsTotal: number;
  details: string[];
  provinceDetails?: ProvinceConstraintDetail[];
  changeRate?: { total: number; changed: number; rate: number };
  productGroup: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  constraints?: Constraint[];
}

export type AppStep = 'upload' | 'constraints' | 'algo-select' | 'optimizing' | 'results';

// Algorithm mode for optimization
// option1: Original SA with historical penalty in cost function
// option2: Two-phase — SA without history penalty, then Hungarian matching for territory IDs
export type AlgorithmMode = 'option1' | 'option2';
