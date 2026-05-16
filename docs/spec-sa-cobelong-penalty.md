# Spec: SA 阶段加入历史共属城市软约束

## 问题

Layer 4 已加入历史共属权重，初始聚类时会把共属城市（如湘潭+张家界）合并到同一簇。但 SA 优化阶段在追求 index 均衡和地理紧凑时，可能把共属城市的医院移到不同 territory，破坏 Layer 4 的初始分配。

需要在 SA 的 cost 函数中加入惩罚，使拆散共属城市的代价可见，SA 在权衡后倾向于保持共属城市在一起。

## 设计

### 约束类型

**软约束**（cost 惩罚）。SA 可以拆散共属城市，但会付出 cost 代价。当 index 均衡收益大于拆散代价时，SA 仍可选择拆散。

### 约束粒度

**城市级**。判断的是"城市 A 和城市 B 是否在同一 territory"，不是具体医院。

### 惩罚逻辑

对每个 territory `t`，收集其中所有医院的城市集合 `citiesInT`。对于 `citiesInT` 中的每个城市 `c`：

1. 查找 `c` 的所有共属城市 `coBelong(c)`
2. 对于每个共属城市 `partner`：如果 `partner ∉ citiesInT`（partner 的医院不在当前 territory 中），则该 territory 中城市 `c` 的所有医院产生惩罚
3. 惩罚量 = 这些医院的 index 总量

### 惩罚公式

```
对每个 territory t:
  citiesInT = { vh.city | vh ∈ t }
  对每个城市 c ∈ citiesInT:
    missingPartners = coBelong(c) \ citiesInT   // 不在当前 territory 中的共属城市
    if missingPartners 非空:
      splitIndex = Σ vh.index (vh ∈ t 且 vh.city == c)
      splitRatio = |missingPartners| / |coBelong(c)|   // 拆散比例
      penalty += splitIndex × splitRatio / coBelongThreshold × BASE_PENALTY
```

- `splitIndex`：被拆散城市在当前 territory 中的 index 总量。index 大的城市被拆散代价更高
- `splitRatio`：拆散比例。城市 A 有 3 个共属城市，缺 1 个 → ratio=1/3；缺 3 个 → ratio=1。全部缺失时惩罚最重
- `coBelongThreshold`：惩罚阈值，控制惩罚强度。建议初始值 = indexTarget（1000），即拆散一个 index=1000 的城市（ratio=1）产生 1 个 BASE_PENALTY 的惩罚

### 示例

湘潭(index=509) 和张家界(index=83) 共属。假设 SA 把湘潭的 4 家医院放在 territory A，张家界的 1 家医院放在 territory B：

- Territory A：包含湘潭但不含张家界
  - splitIndex = 509（湘潭在 A 中的 index）
  - splitRatio = 1/1 = 1（湘潭只有 1 个共属城市张家界，全部缺失）
  - penalty = 509 × 1 / 1000 × 10000 = 5090

- Territory B：包含张家界但不含湘潭
  - splitIndex = 83（张家界在 B 中的 index）
  - splitRatio = 1/1 = 1
  - penalty = 83 × 1 / 1000 × 10000 = 830

- 总惩罚 = 5920

对比：index 越界惩罚（假设越界 200）= 200 / 200 × 10000 = 10000。两者在同一量级，SA 会权衡。

### 数据结构

复用 Layer 4 已构建的 `historyCoBelong: Map<string, Set<string>>`，传入 `calculateCost`。

### 参数

新增 `coBelongThreshold` 到 `EffectiveConstraints`：

```typescript
interface EffectiveConstraints {
  // ... 现有字段
  coBelongThreshold: number;  // 新增，默认 = indexTarget
}
```

## 边界情况

### 传递性共属

A-B 共属，B-C 共属。如果 A 和 C 在同一 territory 但 B 不在：
- A 的共属城市是 B → B 不在 → A 产生惩罚 ✓
- C 的共属城市是 B → B 不在 → C 产生惩罚 ✓
- A 和 C 之间没有直接共属关系 → 不产生额外惩罚 ✓

### 超级节点城市

贵阳与 4 个城市共属。如果贵阳在 territory 中但只有 2 个共属城市也在：
- missingPartners = 2, coBelong(贵阳) = 4
- splitRatio = 2/4 = 0.5
- 惩罚减半，反映"部分保持"的情况 ✓

### 无历史数据

`historyCoBelong` 为空时，惩罚为 0，行为与当前一致。

### 共属城市不在当前产品组

如果共属城市 B 的医院不在当前产品组的 hospitals 列表中（被过滤掉了），则 B 不会出现在任何 territory 中。此时 A 的共属城市 B 永远"缺失"，A 会持续被惩罚。

解决：构建 `historyCoBelong` 时只使用当前产品组的 hospitals，已过滤的城市不会进入共属关系。当前实现已满足（`buildHistoryCoBelong` 的输入是过滤后的 hospitals）。

## 改动范围

1. `calculateCost` 新增 `historyCoBelong` 参数，加入共属城市拆散惩罚
2. `EffectiveConstraints` 新增 `coBelongThreshold` 字段
3. `runOptimization` 将 `historyCoBelong` 传入 `calculateCost`
4. 构建约束时设置 `coBelongThreshold = indexTarget`

## 验收标准

1. 共属城市被拆散时 cost 增加，SA 倾向于保持共属城市在一起
2. 惩罚强度与 index 越界惩罚在同一量级，SA 能在两者间权衡
3. 无历史数据时行为不变
4. 构建通过

## 实施步骤

1. `EffectiveConstraints` 新增 `coBelongThreshold` 字段，默认值 = indexTarget
2. `calculateCost` 新增 `historyCoBelong` 参数，在 per-territory 循环中加入共属城市拆散惩罚
3. `runOptimization` 将 `historyCoBelong` 传入所有 `calculateCost` 调用
4. Worker 重命名（v5→v6）+ 更新引用
5. 构建验证 + 更新版本号
