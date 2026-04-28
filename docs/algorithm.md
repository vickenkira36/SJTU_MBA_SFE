# 辖区分配算法说明

## 总体流程

```
数据上传 → 预处理（医院拆分） → 按省份分组 → 每省独立执行：
  地理聚类（初始分配） → 模拟退火（均衡优化） → [Option2: Hungarian匹配]
→ 汇总结果
```

## 0. 预处理：大医院拆分

对 index > 理想值×1.5（默认 1500）的医院进行虚拟拆分。

**规则：**
- 拆分数 `n = round(index / 理想值)`，最少 2
- 每份 index = `原始index / n`（等分）
- 每份的销量、潜力按 `1/n` 等比缩放

**示例（理想值 = 1000）：**

| 原始 index | 拆分数 | 每份 index |
|-----------|--------|-----------|
| 1400      | 不拆   | 1400      |
| 1600      | 2      | 800       |
| 2224      | 2      | 1112      |
| 6202      | 6      | 1034      |

拆分后的虚拟医院共享同一坐标和城市，但在后续所有阶段中作为独立单元参与分配。同一医院的不同份不允许分到同一个辖区（拆分分散硬约束）。

## 1. 四层地理聚类

将 N 家虚拟医院分配到 K 个簇（K = 辖区数），按地理层级逐步细化。

### Layer 1: 大医院独占簇

- index ≥ 理想值 的医院各自独占一个簇
- 按 index 降序处理，直到簇数用完或没有更多大医院

### Layer 2: 区县聚合

- 将同区县的剩余医院聚合
- 区县 index ≤ 理想值 → 整个区县作为一个簇
- 区县 index 是理想值的 2~3 倍 → 用 Maximin 选种子，拆成多个簇

### Layer 3: 城市聚合

- 将同城市的剩余医院聚合
- 逻辑同 Layer 2，按城市维度

### Layer 4: 组合聚合

- 剩余未分配的医院，用 Maximin 选种子分配

### 1.5 补充机制

- **簇不足**：如果四层处理后簇数 < N，将 index 最大的簇用 Maximin 一分为二，重复直到簇数 = N
- **未分配医院**：兜底分配到最近的簇
- **锁定医院处理**：锁定数据指定医院归属某个 LEL，一个 LEL 下有多个 territory。`buildLockMap` 将 inscode 映射到该 LEL 下所有 territory indices 的集合（`allowedSet`）。聚类末尾按以下规则处理：
  - **非拆分锁定医院**：移到 allowedSet 中 index 总和最低的簇
  - **拆分锁定医院**：各份额 round-robin 分散到 allowedSet 中的不同簇（按簇 index 升序排列后轮流分配），确保同一医院的不同份额不会聚集在同一个 territory，同时所有份额都在指定 LEL 范围内
- **空簇修复（Rebalance）**：锁定处理可能导致某些簇变空。遍历所有空簇，从最大的簇中捐赠一家最小 index 的医院（不违反锁定约束）

### Maximin 种子选择

从候选医院中选 k 个种子，使种子在地理上尽可能分散且兼顾 index 权重：

1. 第 1 个种子：选 index 最高的医院
2. 后续种子：选 `score = minDist × (index / maxIndex)` 最大的候选（minDist 为到所有已选种子的最近距离）
3. 剩余医院分配到最近的种子所在簇

## 2. 模拟退火（SA）

### 2.1 操作

- **Move（60%概率）**：从辖区 t1 随机取一家医院移到相邻辖区 t2
- **Swap（40%概率）**：在相邻辖区 t1、t2 之间交换各一家医院

### 2.2 硬约束过滤

操作执行前先检查，不满足则跳过（不消耗迭代次数的代价计算）：

| 约束 | 处理方式 |
|------|---------|
| 锁定医院（非拆分） | 跳过涉及该医院的 move/swap |
| 锁定医院（拆分） | 允许在 allowedSet 内的 territory 之间 move/swap，跳过目标不在 allowedSet 的操作 |
| 拆分分散 | 跳过会导致同一医院多份聚集的操作 |
| 城市上限 | 跳过会导致目标簇城市数超限的操作 |
| 空辖区保护 | 源 territory 只剩 1 家医院时跳过 move 操作 |
| 空辖区 | 代价函数中给予 1×10⁸ 惩罚 |

### 2.3 代价函数

```
总代价 = Σ 每个辖区的代价
```

每个辖区的代价由以下分项加权求和：

| 分项 | 计算方式 | 权重 |
|------|---------|------|
| Index 偏差 | `(totalIndex - indexTarget)² / indexTarget` | 10 |
| 容量偏差 | `max(hospitalCount - maxCapacity, 0)` | 5 |
| 城市分散度 | `max(cityCount - maxCities, 0)` | 3 |
| 区县集中度 | `max(districtCount - 1, 0)` | 1 |
| 地理跨度 | `maxPairwiseDistance / 100` | 2 |
| 锁定违反 | 医院不在 allowedSet 中 → `index × 10` | 1 |
| 历史稳定性（Option1） | 医院不在历史辖区中 → `index × weight × 10` | 1 |

### 2.4 退火参数

- 初始温度：`T₀ = 初始代价 × 0.1`
- 冷却：`T = T₀ × (1 - step/iterations)`
- 迭代次数：100,000
- 接受概率：`exp(-ΔCost / T)`

## 3. Option2: Hungarian 匹配

Option2 的 SA 阶段不使用历史稳定性惩罚，纯粹优化均衡性。SA 完成后，用 Hungarian 算法将簇映射到历史辖区 ID。

### 3.1 目标

找到簇到辖区的一一映射，使总权重最大化（即尽可能保持历史延续性）。

### 3.2 三层权重矩阵

构建 N×N 的权重矩阵 `weights[cluster_i][histTerritory_j]`，对簇 i 中的每家医院 h，叠加三层贡献：

```
// 医院级：h 是否在历史辖区 j 的医院集合中
if h.inscode ∈ 历史辖区j:
    weight += h.index² × portionWeight / 500

// 区县级：h 的区县是否在历史辖区 j 覆盖的区县集合中
if h.district ∈ 历史辖区j的区县集合:
    weight += 100

// 城市级：h 的城市是否在历史辖区 j 覆盖的城市集合中
if h.city ∈ 历史辖区j的城市集合:
    weight += 50
```

三层贡献叠加，不互斥。历史辖区的区县和城市集合通过历史分配表与医院主数据 join 自动推导。

**历史比例加权（portionWeight）：** 历史分配数据支持可选的 `比例` 字段（0~1），表示每个 rep 对该医院的历史覆盖占比。当一家拆分医院的历史 rep 数 > 拆分份数时（例如历史 3 个 rep 但只拆分为 2 份），算法按比例降序排列，只保留 top-N 个 rep 参与匹配，排除比例最低的 rep。保留的 rep 用 `index² × portion / 500` 加权，比例高的 territory 权重更大。

**示例：** YNKM088（index=2224）历史上 3 个 rep 覆盖，拆分为 2 份：

| Rep | 历史比例 | 是否保留 | 权重贡献 |
|-----|---------|---------|---------|
| TAM177 | 0.54 | ✓ | 2224² × 0.54 / 500 = 5342 |
| TAM143 | 0.28 | ✓ | 2224² × 0.28 / 500 = 2770 |
| TAM219 | 0.18 | ✗（排除） | 0 |

如果历史数据没有比例字段，`portionWeight` 默认为 1，行为与之前一致。

**设计意图：** 大医院（高 index）通过 `index²/500` 在医院级权重中占主导，辖区匹配围绕大医院展开；小医院的医院级权重很低，匹配由区县和城市的地理归属决定。不需要硬阈值，权重连续过渡。

| 医院 index | 医院级贡献 | 区县级 | 城市级 | 主导因素 |
|-----------|-----------|-------|-------|---------|
| 1500 | 4500 | 100 | 50 | 医院 |
| 1000 | 2000 | 100 | 50 | 医院 |
| 500 | 500 | 100 | 50 | 医院 ≈ 地理 |
| 200 | 80 | 100 | 50 | 区县 |
| 50 | 5 | 100 | 50 | 城市/区县 |

### 3.3 Hungarian 算法

使用标准 Hungarian 算法求解最大权重匹配，时间复杂度 O(N³)。

### 3.4 锁定约束

如果某个簇包含锁定医院，该簇应映射到锁定指定 LEL 下的某个辖区。通过将 allowedSet 中所有辖区的权重 `+= 1×10¹²` 实现。对于拆分锁定医院，不同份额在不同簇中，每个簇都会被 boost 到 allowedSet 中的所有辖区，Hungarian 算法在这些选项中选择总权重最大的一一映射。

## 4. Option1 vs Option2 对比

| 维度 | Option1 | Option2 |
|------|---------|---------|
| SA 代价函数 | 包含历史稳定性惩罚 | 不包含 |
| 辖区 ID 分配 | SA 直接决定 | SA 后 Hungarian 匹配 |
| 均衡性 | 受历史惩罚影响 | 纯均衡优化 |
| 历史延续性 | SA 中软约束 | 匹配阶段保证 |

## 5. 约束体系

### 硬约束（违反则操作被跳过或给予极高惩罚）

| 约束 | 执行阶段 | 处理方式 |
|------|---------|---------|
| 空辖区 | 聚类 rebalance + SA | 聚类后修复空簇；SA 阻止 move 导致源辖区变空；代价函数 1×10⁸ 惩罚 |
| 锁定分配（非拆分） | 聚类 + SA | 聚类移到 allowedSet 中最优簇；SA 完全跳过 |
| 锁定分配（拆分） | 聚类 + SA + 匹配 | 聚类分散到 allowedSet 中不同簇；SA 允许在 allowedSet 内移动；匹配 boost 所有 allowed territories |
| 拆分分散 | 聚类 + SA | 聚类检查；SA 跳过违反操作 |
| 城市上限 | 聚类 + SA | 聚类检查；SA 跳过违反操作 |

### 软约束（代价函数中的惩罚项）

| 约束 | 惩罚公式 | 权重 |
|------|---------|------|
| Index 均衡 | `(totalIndex - target)² / target` | 10 |
| 容量上限 | `max(count - max, 0)` | 5 |
| 城市分散 | `max(cities - max, 0)` | 3 |
| 区县集中度 | `max(districtCount - 1, 0)` | 1 |
| 地理跨度 | `maxDist / 100` | 2 |
| 历史稳定性 | `index × weight × 10`（仅 Option1） | 1 |

## 6. 数据流

```
hospitals.xlsx ──→ parseHospitals() ──→ Hospital[]
                                           │
                                    preprocessHospitals()
                                           │
                                    VirtualHospital[]
                                           │
territories.xlsx ──→ parseTerritories() ──→ Territory[]
                                           │
lock.xlsx ──→ parseLockAssignments() ──→ buildLockMap() ──→ LockMap
                                           │
                              ┌─── 按省份分组 ───┐
                              │                  │
                        fourLayerClustering()  buildEffectiveConstraints()
                         (含 lock 处理 +          │
                          rebalance)              │
                              │                  │
                       buildAdjacency()           │
                              │                  │
                       runOptimization() ←────────┘
                              │
                    [matchClustersToHistory()]  ← Option2 only
                       (含历史比例加权)            ↑
                              │          historical.xlsx (含可选比例列)
                       buildResult()
                              │
                    OptimizationResult
```

---

## 7. 变更记录

- **v3.4 Maximin 种子选择加权**：后续种子选择从纯距离改为 `score = minDist × (index / maxIndex)`，同时考虑地理分散和 index 权重。第 1 个种子仍按 index 最高选取。影响范围：Layer 2 区县拆分、Layer 3 城市拆分、簇不足时的一分为二。
