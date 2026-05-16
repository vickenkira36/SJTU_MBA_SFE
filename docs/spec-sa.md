# 将贪心爬山改为模拟退火 Spec

## 问题陈述

`runOptimization` 当前使用贪心爬山（greedy hill climbing）：只接受 `newCost < currentCost` 的移动，拒绝所有劣解。一旦陷入局部最优，后续迭代全部浪费——每次尝试都被拒绝，cost 不再下降。追加迭代次数对此无帮助。

需要引入模拟退火（Simulated Annealing），通过概率性接受劣解来跳出局部最优，在相同或略多的时间内获得更好的全局解。

## 当前算法分析

### 结构

```
fourLayerClustering → 初始解
buildAdjacency → 邻接图
for step in 0..100000:
    随机选相邻辖区对 (t1, t2)
    60% 概率：移动一家医院 t1→t2
    40% 概率：交换两辖区各一家医院
    if newCost < currentCost: 接受
    else: 回滚
```

### Cost 数值范围

- `BASE_PENALTY = 10000`
- Index 违规：超出 200 → +10000，超出 400 → +20000
- 城市/容量违规：每多 1 个 → +10000
- 距离惩罚：200km → +400，500km → +2500
- 单次移动的 delta 通常在 **几百到几万**

### 约束

- 邻接图限制：只在共享城市或地理最近的 3 个辖区间移动/交换
- 城市数上限：移动前检查，超限直接跳过（不进入 cost 计算）
- 锁定医院：不可移动
- 拆分医院：同一医院的不同 portion 不能在同一辖区

## 需求

### 1. 引入模拟退火接受准则

将贪心接受改为 Metropolis 准则：

```
delta = newCost - currentCost
if delta < 0:
    接受（改善）
else:
    以概率 exp(-delta / T) 接受（劣解）
```

温度 T 从初始温度 T0 按冷却计划递减到终止温度 Tmin。

### 2. 温度参数

- **T0（初始温度）**：自适应确定。在正式迭代前，执行少量探测移动（~200 次），统计 delta 的中位数，设 T0 使初始接受率约 50%。公式：`T0 = -deltaMedian / ln(0.5)`。
- **Tmin（终止温度）**：`T0 × 1e-4`。此时接受劣解的概率极低，等效于贪心。
- **冷却方式**：指数冷却 `T = T0 × alpha^step`，其中 `alpha = (Tmin / T0) ^ (1 / iterations)`。

### 3. 迭代次数

从 100,000 增加到 300,000。用户表示当前速度很快，可以接受更长时间。

### 4. 最优解记录

贪心爬山中 currentCost 单调递减，最终解就是最优解。模拟退火中 currentCost 会波动（接受劣解），需要额外记录全局最优：

```
bestAssignments = deepCopy(assignments)
bestCost = currentCost

每次接受后:
  if currentCost < bestCost:
    bestCost = currentCost
    bestAssignments = deepCopy(assignments)

迭代结束后返回 bestAssignments
```

注意：`assignments` 是 `VirtualHospital[][]`（二维数组，元素是对象引用）。deep copy 需要复制数组结构但不需要复制 VirtualHospital 对象本身（对象在迭代中不被修改，只是在数组间移动）。

### 5. 邻接图动态更新

当前邻接图在初始解上构建一次后固定不变。模拟退火中医院会大幅移动，初始邻接关系可能不再准确。

每 50,000 步重建一次邻接图，确保移动操作能覆盖当前布局下的合理邻居。

### 6. 不改动的部分

- `fourLayerClustering` 初始解生成：不变
- `calculateCost` 成本函数：不变
- 移动/交换策略（60/40 比例）：不变
- 城市数上限、锁定医院、拆分医院的硬约束检查：不变
- option2 两阶段流程：不变（SA 改进同时适用于 option1 和 option2）
- Worker 和进度报告：不变

## 验收标准

1. `runOptimization` 使用 Metropolis 准则替代贪心接受
2. 初始温度通过探测移动自适应确定，不需要手动调参
3. 迭代结束后返回全局最优解（bestAssignments），而非最终解
4. 邻接图每 50,000 步重建一次
5. 迭代次数从 100,000 增加到 300,000
6. 构建通过，无 TypeScript 错误
7. 用测试数据运行，结果的 cost 不劣于改动前（允许随机波动，但多次运行的平均值应更优）

## 实施步骤

1. **修改 `runOptimization` 函数**：
   - 在主循环前加入探测阶段（~200 次随机移动，只统计 delta 不实际接受），计算 T0
   - 计算 alpha 冷却系数
   - 主循环中用 Metropolis 准则替代 `if (newCost < currentCost)`
   - 维护 bestAssignments / bestCost
   - 每 50,000 步重建邻接图
   - 迭代结束返回 bestAssignments

2. **修改 `buildEffectiveConstraints`**：将 `iterations` 从 100,000 改为 300,000

3. **验证构建通过**
