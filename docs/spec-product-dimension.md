# Spec: 产品维度重构 — 医院×产品粒度分配

## 问题陈述

当前系统的最小分配单元是"医院"，产品组仅作为隔离维度（按产品组分池独立优化）。这无法表达真实业务场景：

- 同一医院的不同产品可以分给不同代表（大医院场景）
- 同一医院的多个产品应打包给同一代表（小医院场景）
- 代表有岗位性质之分（专岗/混岗），混岗代表覆盖多个产品组
- 无论岗位性质，每个代表的 index 总和目标始终为 1000

需要将最小分配单元从"医院"改为"医院×产品组"，并引入岗位性质驱动的分池逻辑。

## 核心概念

### 分配单元

**当前**：Hospital（一家医院 = 一个分配单元）
**目标**：Hospital × ProductGroup（一家医院的一个产品组 = 一个分配单元）

业务数据中同一 inscode 会出现多行，每行对应一个产品组，各有独立的 sales、potential、index。

### 岗位性质（positionType）

Territory 表新增字段 `岗位性质`（positionType），值为固定枚举（如"专岗A"、"专岗B"、"混岗"等），由用户在输入数据中提供。

- **专岗**：代表只覆盖一个产品组。Territory 表中该代表只有一行。
- **混岗**：代表覆盖多个产品组。Territory 表中该代表有多行（同一 trtyCode，不同产品组），岗位性质相同。

岗位性质不需要系统推导，直接从数据读取。

### 辖区定义

辖区始终以 trtyCode 为唯一标识。混岗代表虽然在 Territory 表中有多行，但 trtyCode 相同，算作一个辖区。优化时需要将同一 trtyCode 的多行合并为一个辖区槽位。

### 分池逻辑

**当前**：按产品组（productGroup）分池，每个产品组独立优化。
**目标**：按岗位性质（positionType）分池，相同岗位性质的代表在同一个池中优化。

- 专岗池：池内只有该产品组的医院×产品行，与当前行为一致
- 混岗池：池内包含该岗位性质覆盖的所有产品组的医院×产品行

产品组与岗位性质一一对应（不会出现同一产品组同时存在于专岗池和混岗池）。

医院×产品行的池归属：通过产品组匹配 Territory 行 → Territory 的岗位性质 → 确定池。

### 小医院捆绑约束（仅混岗池）

在混岗池中，同一医院（inscode）的所有产品行的 index 加总 < indexTarget 时，这些行必须分给同一个代表（同一辖区）。

- 性质：**软约束**（尽量满足，允许例外）
- 适用范围：仅混岗池（专岗池只有一个产品组，不存在跨产品捆绑）
- 阈值：使用 indexTarget（当前为 1000）
- 业务含义：小医院的代表应聚焦覆盖，不应拆给多人

## 数据模型变更

### Territory 类型

```typescript
interface Territory {
  // ... 现有字段不变
  productGroup: string;      // 保留，与医院业务数据对齐
  positionType: string;      // 新增：岗位性质（如"专岗A"、"混岗"）
}
```

### Hospital 类型

不变。每行仍然是一个 Hospital 对象，productGroup 标识其产品组。同一 inscode 可有多行。

### HistoricalAssignment 类型

不变。已经是医院×产品粒度（inscode + productGroup + trtyCode）。

### LockAssignment 类型

不变。已经是医院×产品粒度。

### RegionConstraintParams 类型

```typescript
interface RegionConstraintParams {
  region: string;
  positionType: string;      // 改：从 productGroup 改为 positionType
  // ... 其余字段不变
}
```

### Assignment / TerritoryResult / OptimizationResult

- Assignment.productGroup 保留（记录每个分配单元的产品组）
- OptimizationResult.productGroup → 改为 positionType（标识该结果属于哪个池）
- TerritoryResult 需要能展示一个辖区内多个产品组的汇总

### VirtualHospital（optimizer 内部）

当前 VirtualHospital 是从 Hospital 拆分而来。新模型下：
- 输入已经是医院×产品粒度，每行是一个独立的分配单元
- VirtualHospital 仍然用于 index 拆分（大 index 的医院×产品行拆成多份）
- 新增 `bundleKey`：同一 inscode 且 index 加总 < indexTarget 的行共享同一 bundleKey

## Excel 解析变更

### Territory 解析

- 新增字段映射：`岗位性质` / `positionType` / `position_type` → `positionType`
- 同一 trtyCode 可能出现多行（混岗代表），需要合并为一个辖区
- 合并逻辑：取第一行的 rep/province/region/lel/positionType，收集所有 productGroup

### 业务数据解析

不变。已经支持同一 inscode 多行（每行一个产品组）。

### 历史分配 / 锁定分配解析

不变。已经是医院×产品粒度。

## 优化算法变更

### 分池入口（optimizeByProvince）

**当前**：
```
productGroups = unique(territories.map(t => t.productGroup))
for each pg: filter hospitals & territories by pg → optimizeSingleGroup
```

**目标**：
```
positionTypes = unique(territories.map(t => t.positionType))
for each pt:
  ptTerritories = territories.filter(t => t.positionType === pt)
  // 合并同一 trtyCode 的多行为一个辖区
  ptUniqueTerritories = dedup by trtyCode
  // 收集该池覆盖的产品组
  ptProductGroups = unique(ptTerritories.map(t => t.productGroup))
  // 筛选医院行：产品组在该池覆盖范围内
  ptHospitals = hospitals.filter(h => ptProductGroups.includes(h.productGroup))
  → optimizeSingleGroup(ptHospitals, ptUniqueTerritories, ...)
```

### 辖区数量

辖区数 = 去重后的 trtyCode 数量（不是 Territory 表行数）。

### 小医院捆绑约束（混岗池）

在混岗池的 SA 优化中新增软约束：

1. **预处理**：扫描所有医院×产品行，按 inscode 分组，计算每个 inscode 的 index 总和。index 总和 < indexTarget 的 inscode 标记为"需捆绑"，生成 bundleKey。
2. **代价函数**：新增捆绑惩罚项 — 同一 bundleKey 的行分散在不同辖区时产生惩罚。
3. **SA move/swap**：移动一个行时，检查其 bundleKey，如果是捆绑行，优先将同 bundleKey 的其他行一起移动（或在代价函数中惩罚分散）。

### 城市亲和图

不变。城市亲和基于地理位置，与产品维度无关。

### 四层聚类（fourLayerClustering）

输入从 Hospital[] 变为医院×产品行。聚类逻辑不变（基于地理位置），但需要注意：
- 同一 inscode 的不同产品行地理位置相同
- 捆绑行应在聚类阶段就尽量分到同一簇

### 代价函数

新增一项：

| 分项 | 权重 | 说明 |
|------|------|------|
| 捆绑分散 | 待定 | 同一 bundleKey 的行分散在不同辖区的惩罚（仅混岗池） |

## 前后对比模块变更

### 粒度

从医院粒度改为医院×产品粒度。每个"医院×产品组"独立判断变动分类（kept/added/removed/coverage_added/coverage_removed/reassigned）。

### DrillDownItem

新增 productGroup 字段，展示时显示产品组信息。

### 汇总统计

按辖区汇总时，需要能区分不同产品组的贡献。

## UI 变更

### 约束编辑器（RegionConstraintEditor）

- 分组维度从 productGroup 改为 positionType
- 每个 positionType 一组约束参数

### 结果展示

- TerritoryResult 展示时需要显示辖区覆盖的产品组
- 混岗辖区需要能展开看各产品组的 index/sales/potential 明细

### 对比视图（ComparisonView）

- 变动分类基于医院×产品
- 筛选器增加产品组维度
- 下钻表格显示产品组列

## 不变的部分

- indexTarget = 1000（每个代表，跨产品总和）
- 按省份分组优化的逻辑
- SA 核心算法（模拟退火、Metropolis 准则、自适应 T0）
- 城市亲和图
- 医院 index 拆分（splitThreshold）
- 锁定分配逻辑
- Option1/Option2 算法模式

## 验收标准

1. **Territory 表支持 positionType 列**：解析时正确读取，同一 trtyCode 多行合并为一个辖区
2. **按岗位性质分池优化**：专岗池行为与当前按产品组分池一致；混岗池将多产品组的医院行汇总优化
3. **混岗辖区 index 正确**：一个混岗辖区的 totalIndex = 该辖区内所有产品行的 index 之和，目标 1000
4. **小医院捆绑约束**：混岗池中，inscode 级 index 总和 < indexTarget 的医院，其所有产品行尽量分给同一辖区
5. **前后对比为医院×产品粒度**：每个医院×产品行独立分类变动
6. **约束编辑器按 positionType 分组**：用户可以为每个岗位性质设置独立的约束参数
7. **结果展示支持多产品组辖区**：混岗辖区能展示各产品组的明细
8. **向后兼容**：如果输入数据没有 positionType 列，行为与当前系统一致（按 productGroup 分池）

## 实施步骤

1. **types/index.ts** — Territory 新增 positionType 字段；RegionConstraintParams 的 productGroup 改为 positionType
2. **excel-parser.ts** — Territory 解析新增 positionType 映射；新增 trtyCode 去重合并逻辑
3. **optimizer.ts — 分池逻辑** — optimizeByProvince 从按 productGroup 分池改为按 positionType 分池；处理 trtyCode 去重
4. **optimizer.ts — 捆绑约束** — 新增 bundleKey 预处理；代价函数新增捆绑分散惩罚项；SA move 时考虑捆绑
5. **optimizer.ts — buildResult** — 适配多产品组辖区的 index/sales/potential 汇总
6. **comparison.ts** — 对比粒度改为医院×产品；DrillDownItem 新增 productGroup
7. **RegionConstraintEditor.tsx** — 分组维度从 productGroup 改为 positionType
8. **结果展示组件** — 适配多产品组辖区展示
9. **ComparisonView.tsx** — 适配医院×产品粒度的变动展示
10. **向后兼容处理** — 无 positionType 时 fallback 到 productGroup 分池
11. **验证** — 构建通过、专岗/混岗/无岗位性质三种场景测试
