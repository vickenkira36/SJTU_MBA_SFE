#!/usr/bin/env bash
# scripts/push.sh — 自动推送本仓库到 vickenkira36/SJTU_MBA_SFE
#
# 流程：
#   1. 从环境变量或 ~/.zshrc 读取 MBA_SFE PAT
#   2. 把 PAT 注入到 origin URL
#   3. git push --force-with-lease origin main
#   4. 无论成败都把 URL 清理回不含 PAT 的形式
#
# 用法：
#   bash scripts/push.sh              # 推 main 分支
#   bash scripts/push.sh feature-x    # 推其它分支
#
# 前置条件：
#   ~/.zshrc 里有 export MBA_SFE="<vickenkira36 的 PAT>"
#   或者当前 shell 已经 export MBA_SFE

set -e

# === 1. 加载 PAT ===
if [ -z "$MBA_SFE" ]; then
    # 从 ~/.zshrc 提取 export MBA_SFE=... 那一行
    MBA_SFE_LINE=$(grep -E '^export MBA_SFE=' "$HOME/.zshrc" 2>/dev/null | head -1 || true)
    if [ -n "$MBA_SFE_LINE" ]; then
        eval "$MBA_SFE_LINE"
    fi
fi

if [ -z "$MBA_SFE" ]; then
    echo "❌ 未找到 MBA_SFE 环境变量"
    echo ""
    echo "请在 ~/.zshrc 末尾添加这一行（替换为你的真实 PAT）："
    echo "  export MBA_SFE=\"ghp_xxxxxxxxxxxxxxxxxxxx\""
    echo ""
    echo "然后 source ~/.zshrc 或重开 terminal"
    exit 1
fi

# === 2. 注入 PAT 到 remote URL ===
REPO_URL="https://vickenkira36:${MBA_SFE}@github.com/vickenkira36/SJTU_MBA_SFE.git"
git remote set-url origin "$REPO_URL"

# === 3. push（默认 main 分支，可通过参数覆盖）===
BRANCH="${1:-main}"
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
