# 运筹算法在制药企业 SFE 辖区动态分配中的应用及商业化研究

上海交通大学安泰经济与管理学院 MBA 学位论文项目仓库。

- **作者**：陈一（学号 124120935584）
- **导师**：葛冬冬教授
- **研究主题**：运筹优化算法（六层地理聚类 + 模拟退火 + Hungarian 匹配）在制药企业 SFE（Sales Force Effectiveness）辖区动态分配中的落地应用，包括数学模型构建、算法设计、实证验证及商业化探索

## 项目双产物

本仓库同时承载两个相关产物：

1. **MBA 学位论文**（主产物）—— 单源文件 `docs/thesis.md`，目标 4 万字，分 7 章
2. **Next.js 算法 demo**（配套）—— 论文中两阶段算法的可交互实现，作为方法论的工程化验证

## 论文相关

### 章节大纲（7 章）

| 章 | 标题 | 字数目标 |
|---|---|---|
| 第一章 | 绪论 | 4,500 |
| 第二章 | 理论基础与文献综述 | 5,000 |
| 第三章 | 制药企业 SFE 辖区管理现状与痛点诊断 | 5,000 |
| 第四章 | 基于综合价值指数的智能辖区分配模型构建 | 10,000 |
| 第五章 | 实证分析与多地理形态验证 | 8,500 |
| 第六章 | 企业内部管理的配套及算法的商业化前景评估 | 4,000 |
| 第七章 | 结论与展望 | 3,000 |

### 论文文件结构

```
docs/
├── thesis.md                              # 论文唯一源文件（单源模式）
├── thesis.docx                            # pandoc + post-process 生成产物
├── thesis-meta.json                       # 封面/页眉信息配置（复用本模板只需改这里）
├── references.bib                         # BibTeX 文献数据库
├── gb-t-7714-2015-numeric.csl             # GB/T 7714-2015 国标引用样式
├── create_template.py                     # 生成 antai-template.docx（字体/字号/页边距/页眉页脚）
├── post_process_docx.py                   # 封面+目录+分章页眉+分段页码+表格处理
├── antai-template.docx                    # 安泰 MBA 论文格式模板（由 create_template.py 生成）
├── superscript-cite.lua                   # pandoc 引用上标 lua filter
├── figures/                               # 论文图（fig1-X ~ fig6-X）+ sjtu-logo.png 校徽
├── industry-reports/                      # 行业调研报告 PDF（IQVIA、中康、麦肯锡）
├── archive/                               # BibTeX 迁移前的章节快照（只读）
└── *.pdf                                  # 参考文献库（中外学术、政策法规）

scripts/
├── build-docx.sh                          # 一键生成 thesis.docx（含封面/目录/页眉页码）
├── build-review.sh                        # 生成可批注的 HTML 预览页（review 用）
└── assemble-review-html.py                # 批注页组装脚本
```

### 一键生成 docx

```bash
bash scripts/build-docx.sh
```

该脚本完成：pandoc 转换（含 BibTeX 引用 + GB/T 7714 国标样式）→ post-process
（插入封面页与校徽、目录 TOC 域、按章分节的页眉、分段页码、表格 AutoFit）。

生成后在 Word 中打开，按提示**更新域**一次即可生成目录页码（详见格式指南）。

### 复用本套格式（给同学）

本仓库的格式工具链与论文内容解耦，可直接复用到其他 SJTU 学位论文：

1. 改 `docs/thesis-meta.json` —— 封面的姓名/学号/导师/院系/题目、页眉文字
2. 换 `docs/thesis.md` —— 你自己的论文正文（保持 `# 第X章` 一级标题结构）
3. 跑 `bash scripts/build-docx.sh`

格式细节（页边距、字号、页眉页脚、分段页码规则、目录更新方法）见
[docs/格式使用指南.md](docs/格式使用指南.md)。完整写作规范见 [AGENTS.md](AGENTS.md)。

## 算法 demo（Next.js）

可交互的辖区分配算法演示，对应论文第四章设计的两阶段法（六层聚类 + 模拟退火 + Hungarian 匹配）。

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

- 算法核心实现：`src/lib/optimizer.ts`
- 算法设计文档：`docs/algorithm.md`
- 代码同步上游：`github.com/cheny128_roche/sfe-territory-alignment`（论文锁定 commit `cbc1a756`）

## 关键文档

- [AGENTS.md](AGENTS.md) — 论文写作智能体规范（结构、格式、引用、降 AIGC 风格、案例参照）
- [docs/algorithm.md](docs/algorithm.md) — 算法详细设计文档
- [docs/archive/README.md](docs/archive/README.md) — 历史章节归档说明

## 进度

- ✅ 全文七章 + 摘要/Abstract + 附录全部完成
- ✅ 图表数据来源全部追溯并标注（GB/T 7714 合规）
- ✅ 学位论文格式就位（封面 + 校徽 + 目录 + 分章页眉 + 分段页码）
- ✅ 跨章逻辑一致性自检通过
