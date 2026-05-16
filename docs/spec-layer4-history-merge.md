# Spec: Layer 4 合并策略引入历史共属权重

## 问题

四层聚类的 Layer 4 在合并城市组时，纯粹按物理距离决定合并顺序。历史上属于同一 territory 的城市（如湘潭+张家界同属 BC_TAM437）会因为物理距离较远而被拆散，各自合并到距离更近的其他城市组。

示例：
- 湘潭（index=509）↔ 张家界（index=83）：189km，历史同属 BC_TAM437
- 湘潭 ↔ 长沙：50km，无历史关系
- 当前结果：湘潭被合并到长沙（50 < 189），张家界落单
- 期望结果：湘潭和张家界优先合并（历史共属）

### 当前数据的实际影响

Layer 2/3 的进入条件是城市 index 总量 >= indexMin（800）。当前数据中：

| 分层 | 城市数 | 说明 |
|------|--------|------|
| Layer 2/3 处理 | 97 | 城市 index >= 800 |
| Layer 4 处理 | 220 | 城市 index < 800 |

Layer 4 中有大量历史共属关系会被触发：
- 双方都在 Layer 4 的共属城市对：**136 对**
- 一方在 Layer 4 的共属城市对：106 对（一方已被 Layer 2/3 处理，共属关系不影响）

典型案例：湘潭(509)+张家界(83)、漯河(571)+许昌(645)、商丘(514)+开封(582)、丽水(629)+衢州(489)、汉中(476)+安康(292) 等。

## 改动范围

只改 `fourLayerClustering` 中 Layer 4 的合并评分逻辑。不改 Layer 1-3、SA 主循环、cost 函数。

## 设计

### 合并评分两层优先级

| 优先级 | 关系 | score | 说明 |
|--------|------|-------|------|
| 高 | 历史共属 | `distance / 10000` | 值域 (0, ~0.5)，距离近优先 |
| 低 | 无关系 | `distance` | 纯物理距离（km），值域 [几十, 几千] |

去掉当前的城市亲和 0.3 折扣逻辑。城市亲和的作用已被历史共属完全覆盖。

### 历史共属 score 内部 tie-break

多对城市组都有历史共属时，`score = distance / 10000` 自然按距离排序。距离近的 score 更小，贪心合并优先选中。中国最远城市对距离约 5000km，`5000/10000 = 0.5`，仍远小于纯距离 score 的最小值（几十 km）。

### 传递性吸入

合并后的组继承组内所有城市的共属关系。即 A-B 共属、B-C 共属时，B 先和距离近的一方合并后，另一方在后续轮次仍能通过 B 找到共属关系，最终 A+B+C 合成一组。

**已确认可接受**：历史关联城市合在一起是合理的。

### 历史共属判定

两个城市组 I 和 J，如果存在城市 ci ∈ I 和城市 cj ∈ J，使得 ci 和 cj 在 `historicalAssignments` 中属于同一个 `trtyCode`，则 I 和 J 为历史共属。

### 数据结构

构建 `historyCoBelong: Map<string, Set<string>>`：城市 → 历史上同 trtyCode 的其他城市集合。

```
输入：historicalAssignments + hospitals（提供 inscode→city 映射）
构建：
  1. 遍历 historicalAssignments，按 trtyCode 分组，收集每个 trtyCode 下的城市集合
  2. 同一 trtyCode 下的城市互相加入对方的 historyCoBelong 集合
```

### 函数签名变更

```typescript
function fourLayerClustering(
  hospitals: VirtualHospital[],
  n: number,
  maxCities: number,
  indexTarget: number,
  lockMap?: LockMap,
  cityAffinity?: CityAffinityMap,
  historyCoBelong?: Map<string, Set<string>>  // 新增参数
): VirtualHospital[][]
```

### Layer 4 合并评分修改

```
当前逻辑（替换）：
  score = distance
  if (亲和) score = distance × 0.3

新逻辑：
  if (历史共属) score = distance / 10000   // 值域 (0, 0.5)，距离近优先
  else score = distance                     // 值域 [几十, 几千]
```

## 验收标准

1. 历史共属城市对在 Layer 4 中被优先合并（score < 1 vs 纯距离 score > 1）
2. 多对共属城市 tie-break 时，距离近的优先合并
3. 传递性吸入正常工作（A-B 共属、B-C 共属 → A+B+C 合成一组）
4. 无历史数据时行为与当前一致（historyCoBelong 为空，所有 score = distance）
5. 构建通过，无类型错误

## 实施步骤

1. 新增 `buildHistoryCoBelong` 函数，从 historicalAssignments 构建城市共属 Map
2. `fourLayerClustering` 新增 `historyCoBelong` 参数
3. Layer 4 合并评分：去掉 cityAffinity 折扣逻辑，替换为历史共属检查 + 距离 tie-break
4. 更新 `fourLayerClustering` 的调用点，传入 `historyCoBelong`
5. Worker 重命名强制 Turbopack 重编译
6. 构建验证 + 更新版本号
