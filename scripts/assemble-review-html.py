# -*- coding: utf-8 -*-
"""把 pandoc 生成的正文 HTML 片段组装成可批注的单文件预览页。

- 给每个块级元素（p / li / h1-h4 / table / figure / blockquote）打 data-anchor 编号
- 图片转 base64 内联，保证 HTML 文件移动到任何位置都能看图
- 注入批注交互层：选中文字 → 写建议 → 存 localStorage → 一键导出 JSON
"""
import sys
import re
import base64
import mimetypes
from pathlib import Path

if len(sys.argv) != 3:
    print("用法: python3 assemble-review-html.py <body.html> <out.html>")
    sys.exit(1)

body_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
docs_dir = out_path.parent  # 图片相对路径基准目录

body = body_path.read_text(encoding="utf-8")

# ---------- 1) 图片内联为 base64 ----------
def inline_img(m):
    src = m.group(1)
    if src.startswith("data:") or src.startswith("http"):
        return m.group(0)
    img_path = (docs_dir / src).resolve()
    if not img_path.exists():
        return m.group(0)
    mime, _ = mimetypes.guess_type(str(img_path))
    mime = mime or "image/png"
    b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
    return f'src="data:{mime};base64,{b64}"'

body = re.sub(r'src="([^"]+)"', inline_img, body)

# ---------- 2) 给块级元素打锚点编号 ----------
# 只给顶层块的开标签插 data-anchor；表格/figure 整体算一个锚点
counter = [0]

def add_anchor(m):
    counter[0] += 1
    tag = m.group(1)
    return f'<{tag} data-anchor="A{counter[0]}"'

# 匹配段落、列表项、标题、表格、figure、引用块的开标签（无已有属性的简单形式）
body = re.sub(r'<(p|li|h1|h2|h3|h4|table|figure|blockquote)(?=[ >])',
              add_anchor, body)

total_anchors = counter[0]

# ---------- 3) 注入模板 ----------
TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>论文批注预览 — 运筹算法在制药企业 SFE 辖区动态分配中的应用及商业化研究</title>
<style>
  :root { --accent:#c0392b; --hl:#fff3a0; --hl-active:#ffd54a; }
  * { box-sizing:border-box; }
  body {
    margin:0; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    color:#1a1a1a; background:#f4f4f6; line-height:1.9;
  }
  /* 主体两栏：左正文 + 右批注栏 */
  .wrap { display:flex; max-width:1400px; margin:0 auto; }
  .doc {
    flex:1 1 auto; background:#fff; padding:48px 56px; min-width:0;
    box-shadow:0 1px 4px rgba(0,0,0,.08); border-radius:4px; margin:16px;
  }
  .sidebar {
    flex:0 0 320px; padding:16px 16px 16px 0; position:sticky; top:0;
    align-self:flex-start; max-height:100vh; overflow-y:auto;
  }
  /* 正文排版 */
  .doc h1 { font-size:1.6em; border-bottom:2px solid #ddd; padding-bottom:.3em; margin-top:1.4em; }
  .doc h2 { font-size:1.32em; margin-top:1.3em; }
  .doc h3 { font-size:1.14em; color:#333; }
  .doc h4 { font-size:1.02em; color:#444; }
  .doc p { margin:.7em 0; text-align:justify; }
  .doc table { border-collapse:collapse; width:100%; margin:1em 0; font-size:.92em; }
  .doc th, .doc td { border:1px solid #bbb; padding:6px 9px; text-align:left; }
  .doc th { background:#f0f0f2; }
  .doc figure { text-align:center; margin:1.2em 0; }
  .doc figure img { max-width:90%; height:auto; border:1px solid #eee; }
  .doc figcaption { font-size:.88em; color:#666; margin-top:.4em; }
  .doc sup { color:var(--accent); font-weight:600; }
  /* 已批注高亮 */
  .commented { background:var(--hl); border-radius:2px; cursor:pointer; padding:0 1px; }
  .commented.focus { background:var(--hl-active); outline:1px solid #e6a700; }
  /* 顶栏 */
  .topbar {
    position:sticky; top:0; z-index:50; background:#fff; border-bottom:1px solid #e0e0e0;
    padding:10px 24px; display:flex; gap:12px; align-items:center;
    box-shadow:0 1px 3px rgba(0,0,0,.06);
  }
  .topbar h1 { font-size:1em; margin:0; flex:1; color:#333; font-weight:600; }
  .btn {
    border:none; padding:7px 14px; border-radius:5px; cursor:pointer; font-size:.88em;
    background:var(--accent); color:#fff; transition:opacity .15s;
  }
  .btn:hover { opacity:.88; }
  .btn.ghost { background:#eee; color:#333; }
  .count-badge { font-size:.85em; color:#888; }
  /* 批注卡片 */
  .cmt-card {
    background:#fff; border:1px solid #e2e2e2; border-left:3px solid var(--accent);
    border-radius:5px; padding:10px 12px; margin-bottom:10px; font-size:.86em;
    box-shadow:0 1px 2px rgba(0,0,0,.05); cursor:pointer;
  }
  .cmt-card.focus { border-left-color:#e6a700; background:#fffdf3; }
  .cmt-card .quote { color:#888; font-style:italic; margin-bottom:5px; border-left:2px solid #ddd; padding-left:7px; }
  .cmt-card .note { color:#222; white-space:pre-wrap; }
  .cmt-card .meta { font-size:.8em; color:#aaa; margin-top:6px; display:flex; justify-content:space-between; }
  .cmt-card .del { color:#c0392b; cursor:pointer; }
  .sidebar-empty { color:#aaa; font-size:.88em; padding:20px; text-align:center; }
  /* 批注输入弹层 */
  .popover {
    position:absolute; z-index:100; background:#fff; border:1px solid #ccc; border-radius:6px;
    box-shadow:0 4px 16px rgba(0,0,0,.18); padding:12px; width:300px; display:none;
  }
  .popover textarea {
    width:100%; height:72px; border:1px solid #ccc; border-radius:4px; padding:6px;
    font-family:inherit; font-size:.9em; resize:vertical;
  }
  .popover .quote-preview { font-size:.8em; color:#888; margin-bottom:6px; max-height:48px; overflow:auto; }
  .popover .row { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
  @media print { .sidebar,.topbar { display:none; } .doc { box-shadow:none; margin:0; } }
</style>
<script>
  MathJax = { tex: { inlineMath: [['$','$'],['\\(','\\)']], displayMath: [['$$','$$'],['\\[','\\]']] } };
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js" id="MathJax-script" async></script>
</head>
<body>
<div class="topbar">
  <h1>论文批注预览 · 选中正文文字即可添加修改建议</h1>
  <span class="count-badge" id="countBadge">0 条批注</span>
  <button class="btn" id="exportBtn">导出批注 JSON</button>
  <button class="btn ghost" id="clearBtn">清空全部</button>
</div>
<div class="wrap">
  <div class="doc" id="doc">
__BODY__
  </div>
  <div class="sidebar" id="sidebar">
    <div class="sidebar-empty" id="sidebarEmpty">还没有批注。<br>在左侧选中要修改的文字，写下你的建议。</div>
  </div>
</div>

<div class="popover" id="popover">
  <div class="quote-preview" id="popQuote"></div>
  <textarea id="popText" placeholder="写下你的修改建议…（例如：这句太啰嗦，建议精简为…）"></textarea>
  <div class="row">
    <button class="btn ghost" id="popCancel">取消</button>
    <button class="btn" id="popSave">保存批注</button>
  </div>
</div>

<script>
const STORAGE_KEY = "thesis_comments_v1";
let comments = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
let pendingSel = null;
let nextId = comments.reduce((m,c)=>Math.max(m,c.id),0) + 1;

const doc = document.getElementById("doc");
const popover = document.getElementById("popover");
const popText = document.getElementById("popText");
const popQuote = document.getElementById("popQuote");

// —— 找到选区所在的锚点块 ——
function anchorOf(node){
  let el = node.nodeType === 3 ? node.parentElement : node;
  while (el && el !== doc){
    if (el.dataset && el.dataset.anchor) return el.dataset.anchor;
    el = el.parentElement;
  }
  return null;
}

// —— 选中文字后弹出批注框 ——
document.addEventListener("mouseup", (e)=>{
  if (popover.contains(e.target)) return;
  const sel = window.getSelection();
  const text = sel.toString().trim();
  if (!text){ hidePopover(); return; }
  const range = sel.getRangeAt(0);
  const anchor = anchorOf(range.startContainer);
  if (!anchor){ hidePopover(); return; }
  pendingSel = { anchor, quote:text };
  const rect = range.getBoundingClientRect();
  popQuote.textContent = "「" + (text.length>60?text.slice(0,60)+"…":text) + "」";
  popText.value = "";
  popover.style.display = "block";
  let top = window.scrollY + rect.bottom + 6;
  let left = window.scrollX + rect.left;
  const pw = 300;
  if (left + pw > document.documentElement.clientWidth) left = document.documentElement.clientWidth - pw - 12;
  popover.style.top = top + "px";
  popover.style.left = left + "px";
  popText.focus();
});

function hidePopover(){ popover.style.display="none"; pendingSel=null; }
document.getElementById("popCancel").onclick = hidePopover;
document.getElementById("popSave").onclick = ()=>{
  const note = popText.value.trim();
  if (!note || !pendingSel){ hidePopover(); return; }
  comments.push({ id: nextId++, anchor: pendingSel.anchor, quote: pendingSel.quote, note });
  persist(); render(); hidePopover();
  window.getSelection().removeAllRanges();
};

// —— 持久化 + 渲染 ——
function persist(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(comments)); }

function clearHighlights(){
  doc.querySelectorAll(".commented").forEach(s=>{
    const parent = s.parentNode;
    parent.replaceChild(document.createTextNode(s.textContent), s);
    parent.normalize();
  });
}

// 在锚点块内高亮首个匹配的 quote 文本
function highlight(c){
  const block = doc.querySelector(`[data-anchor="${c.anchor}"]`);
  if (!block) return;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())){
    const idx = node.nodeValue.indexOf(c.quote);
    if (idx >= 0){
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + c.quote.length);
      const span = document.createElement("span");
      span.className = "commented";
      span.dataset.cid = c.id;
      try { range.surroundContents(span); } catch(e){ /* 跨标签选区跳过高亮 */ }
      span.onclick = ()=>focusComment(c.id);
      return;
    }
  }
}

function render(){
  clearHighlights();
  comments.forEach(highlight);
  // 侧栏
  const sb = document.getElementById("sidebar");
  sb.querySelectorAll(".cmt-card").forEach(n=>n.remove());
  const empty = document.getElementById("sidebarEmpty");
  empty.style.display = comments.length ? "none" : "block";
  comments.forEach(c=>{
    const card = document.createElement("div");
    card.className = "cmt-card";
    card.dataset.cid = c.id;
    card.innerHTML = `<div class="quote">「${escapeHtml(c.quote.length>50?c.quote.slice(0,50)+"…":c.quote)}」</div>
      <div class="note">${escapeHtml(c.note)}</div>
      <div class="meta"><span>${c.anchor}</span><span class="del">删除</span></div>`;
    card.querySelector(".del").onclick = (e)=>{ e.stopPropagation(); removeComment(c.id); };
    card.onclick = ()=>focusComment(c.id);
    sb.appendChild(card);
  });
  document.getElementById("countBadge").textContent = comments.length + " 条批注";
}

function focusComment(id){
  document.querySelectorAll(".focus").forEach(n=>n.classList.remove("focus"));
  const span = doc.querySelector(`.commented[data-cid="${id}"]`);
  const card = document.querySelector(`.cmt-card[data-cid="${id}"]`);
  if (span){ span.classList.add("focus"); span.scrollIntoView({behavior:"smooth",block:"center"}); }
  if (card){ card.classList.add("focus"); }
}

function removeComment(id){
  comments = comments.filter(c=>c.id!==id);
  persist(); render();
}

function escapeHtml(s){ return s.replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

// —— 导出 ——
document.getElementById("exportBtn").onclick = ()=>{
  if (!comments.length){ alert("还没有批注可导出。"); return; }
  const payload = {
    doc: "thesis.md",
    exported_at: new Date().toISOString(),
    total: comments.length,
    comments: comments.map(c=>({ anchor:c.anchor, quote:c.quote, note:c.note }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "thesis-comments.json";
  a.click();
};

document.getElementById("clearBtn").onclick = ()=>{
  if (comments.length && confirm("确定清空全部 " + comments.length + " 条批注？")){
    comments = []; persist(); render();
  }
};

render();
</script>
</body>
</html>
'''

html = TEMPLATE.replace("__BODY__", body)
out_path.write_text(html, encoding="utf-8")
print(f"  锚点块数: {total_anchors}, 输出: {out_path}")
