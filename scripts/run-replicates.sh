#!/usr/bin/env bash
# scripts/run-replicates.sh — 多次重复运行，用于 5.2/5.3 主样本选优与 5.4.2 敏感性扫描
#
# SA 为随机化算法（optimizer.ts 使用无种子 Math.random），单次运行结果存在波动。
# 本脚本对每个配置重复 N 次：
#   - 主样本（默认 500K）：3 省 × N 次，供按代价函数选最优
#   - 敏感性扫描：3 省 × 4 档 × N 次，供报均值 ± 标准差
#
# 每次运行的 stdout 存入 run.log，其中 [SA诊断] 行含 `最终best=<cost>`，
# 由 scripts/aggregate-replicates.py 抓取作为选优依据。
#
# 用法：bash scripts/run-replicates.sh [N]        （N 默认 10，PAR=4 控制并发）
# 汇总：python3 scripts/aggregate-replicates.py

set -e

N="${1:-10}"
PAR="${PAR:-4}"
ROOT="data/case/output/replicates"
PROVINCES=("上海市:上海" "湖南省:湖南" "新疆维吾尔自治区:新疆")
ITERATIONS=(100000 300000 500000 1000000)

mkdir -p "$ROOT"
JOBS="$(mktemp)"

# 作业行格式："<省全名> <输出目录> <迭代次数|0>"，0 表示走 optimizer.ts 默认 500000。
# 三字段均不含空格，故可直接由 xargs -n 3 拆成位置参数。
for pair in "${PROVINCES[@]}"; do
    full="${pair%%:*}"; tag="${pair##*:}"
    for r in $(seq 1 "$N"); do
        echo "${full} ${ROOT}/main/${tag}-r${r} 0" >> "$JOBS"
    done
    for it in "${ITERATIONS[@]}"; do
        for r in $(seq 1 "$N"); do
            echo "${full} ${ROOT}/sweep/${tag}-iter${it}-r${r} ${it}" >> "$JOBS"
        done
    done
done

TOTAL=$(wc -l < "$JOBS" | tr -d ' ')
echo "共 ${TOTAL} 次运行（主样本 $((3*N)) + 扫描 $((3*4*N))），并发 ${PAR}"
echo "输出根目录：${ROOT}"
echo ""

run_one() {
    local full="$1" out="$2" it="$3"
    [ -f "${out}/metrics.json" ] && { echo "[skip] ${out}"; return 0; }
    mkdir -p "$out" || { echo "[ERR-mkdir] ${out}"; return 0; }
    if [ "$it" = "0" ]; then
        npx tsx scripts/run-experiment.ts --dataset bc --province "$full" \
            --output-dir "$out" > "${out}/run.log" 2>&1
    else
        npx tsx scripts/run-experiment.ts --dataset bc --province "$full" \
            --iterations "$it" --output-dir "$out" > "${out}/run.log" 2>&1
    fi
    python3 scripts/compute-metrics.py "${out}/result.json" >> "${out}/run.log" 2>&1
    [ -f "${out}/metrics.json" ] && echo "[ok] ${out}" || echo "[FAIL] ${out}"
}
export -f run_one

# -n 3：每次取三个字段作为 $0 $1 $2 传给 bash -c
xargs -P "$PAR" -n 3 bash -c 'run_one "$0" "$1" "$2"' < "$JOBS"
rm -f "$JOBS"

echo ""
echo "✓ 全部完成。下一步：python3 scripts/aggregate-replicates.py"
