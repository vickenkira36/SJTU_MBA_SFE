#!/usr/bin/env bash
# scripts/push.sh — 自动推送本仓库到 vickenkira36/SJTU_MBA_SFE
#
# 流程：
#   1. 从 .env / 环境变量 / ~/.zshrc 读取 MBA_SFE PAT（按优先级顺序）
#   2. 把 PAT 注入到 origin URL
#   3. git push --force-with-lease origin main
#   4. 无论成败都把 URL 清理回不含 PAT 的形式
#
# 用法：
#   bash scripts/push.sh              # 推 main 分支
#   bash scripts/push.sh feature-x    # 推其它分支
#
# 前置条件（推荐）：项目根目录有 .env 文件，含一行：
#   MBA_SFE=ghp_xxxxxxxxxxxxxxxxxxxx
#
# .env 已被 .gitignore 排除，且 Claude Code 默认 deny 读 .env，PAT 安全

set -e

# === 1. 加载 PAT ===

# 优先级 1: 当前环境变量（如果已经 export）
# 优先级 2: 项目根目录 .env 文件
if [ -z "$MBA_SFE" ] && [ -f .env ]; then
    MBA_SFE_LINE=$(grep -E '^MBA_SFE=' .env | head -1 || true)
    if [ -n "$MBA_SFE_LINE" ]; then
        # 去掉 MBA_SFE= 前缀和可选的引号
        MBA_SFE=$(echo "$MBA_SFE_LINE" | sed -E 's/^MBA_SFE=["'\'']?([^"'\'']*)["'\'']?$/\1/')
        export MBA_SFE
    fi
fi

# 优先级 3: ~/.zshrc
if [ -z "$MBA_SFE" ]; then
    MBA_SFE_LINE=$(grep -E '^export MBA_SFE=' "$HOME/.zshrc" 2>/dev/null | head -1 || true)
    if [ -n "$MBA_SFE_LINE" ]; then
        eval "$MBA_SFE_LINE"
    fi
fi

if [ -z "$MBA_SFE" ]; then
    echo "❌ 未找到 MBA_SFE"
    echo ""
    echo "请在项目根目录创建 .env 文件（已被 .gitignore 排除），添加一行："
    echo "  MBA_SFE=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxx"
    echo ""
    echo "或者在 ~/.zshrc 里：export MBA_SFE=\"...\""
    exit 1
fi

# === 2. 注入 PAT 到 remote URL ===
REPO_URL="https://vickenkira36:${MBA_SFE}@github.com/vickenkira36/SJTU_MBA_SFE.git"
git remote set-url origin "$REPO_URL"

# === 3. push（默认 main 分支，可通过参数覆盖）===
BRANCH="${1:-main}"

# 先 fetch 一下远端最新状态，避免 --force-with-lease 因本地 ref 过期
# 报 "stale info" 错误。若 fetch 失败（比如远端无该分支）不致命。
echo "→ 同步远端 ref ..."
git fetch origin "$BRANCH" 2>/dev/null || true

echo "→ 正在推送到 origin/$BRANCH ..."
PUSH_OK=0
git push --force-with-lease origin "$BRANCH" || PUSH_OK=$?

# === 4. 不论成败都清理 URL（避免 PAT 残留在 .git/config）===
git remote set-url origin "https://github.com/vickenkira36/SJTU_MBA_SFE.git"

if [ $PUSH_OK -eq 0 ]; then
    echo "✓ push 完成，URL 已清理"
else
    echo "⚠ push 失败（exit $PUSH_OK），URL 已清理"
    exit $PUSH_OK
fi
