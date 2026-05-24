#!/usr/bin/env bash
# scripts/run-sensitivity.sh — 第 5.4.2 节 SA 迭代次数敏感性扫描
#
# 在三个样本（上海/湖南/新疆 BC）上分别以 100K / 300K / 500K（默认）/ 1M
# 四档 SA 迭代次数运行算法，输出到 data/case/output/sensitivity/。
#
# 跑完后：python3 scripts/compute-sensitivity.py 汇总指标。

set -e

ITERATIONS=(100000 300000 500000 1000000)
PROVINCES=("上海市:上海" "湖南省:湖南" "新疆维吾尔自治区:新疆")

for prov_pair in "${PROVINCES[@]}"; do
    prov_full="${prov_pair%%:*}"
    prov_tag="${prov_pair##*:}"
    for iter in "${ITERATIONS[@]}"; do
        out="data/case/output/sensitivity/bc-${prov_tag}-iter${iter}"
        if [ -f "${out}/result.json" ]; then
            echo "[skip] ${out}/result.json 已存在"
            continue
        fi
        echo ""
        echo "=== ${prov_full}, iterations=${iter} ==="
        npx tsx scripts/run-experiment.ts \
            --dataset bc \
            --province "${prov_full}" \
            --iterations "${iter}" \
            --output-dir "${out}"
    done
done

echo ""
echo "✓ 12 次敏感性扫描全部完成"
echo "  下一步：python3 scripts/compute-sensitivity.py"
