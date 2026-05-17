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
| 第五章 | 实证分析与多场景模拟验证 | 8,500 |
| 第六章 | 企业内部管理的配套及算法的商业化前景评估 | 4,000 |
| 第七章 | 结论与展望 | 3,000 |

### 论文文件结构

```
docs/
├── thesis.md                              # 论文唯一源文件（单源模式）
├── thesis.docx                            # pandoc + post-process 生成产物
├── references.bib                         # BibTeX 文献数据库
├── gb-t-7714-2015-numeric.csl             # GB/T 7714-2015 国标引用样式
├── post_process_docx.py                   # Word 表格 AutoFit + 边框 + 防跨页脚本
├── antai-template.docx                    # 安泰 MBA 论文格式模板
├── superscript-cite.lua                   # pandoc 引用上标 lua filter
├── figures/                               # 论文图（fig1-X、fig3-X、fig4-X）
├── industry-reports/                      # 行业调研报告 PDF（IQVIA、中康、麦肯锡）
├── archive/                               # BibTeX 迁移前的章节快照（只读）
└── *.pdf                                  # 参考文献库（中外学术、政策法规）
```

### 生成 docx

```bash
pandoc docs/thesis.md -o docs/thesis.docx \
  --reference-doc=docs/antai-template.docx \
  --lua-filter=docs/superscript-cite.lua \
  --resource-path=docs \
  --citeproc \
  --bibliography=docs/references.bib \
  --csl=docs/gb-t-7714-2015-numeric.csl

python3 docs/post_process_docx.py docs/thesis.docx
```

完整规范见 [AGENTS.md](AGENTS.md)。

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

- ✅ 第一至四章已完成（含图表、引用、BibTeX）
- ⏳ 第五至七章待写作
- ✅ 图表数据来源全部追溯并标注（GB/T 7714 合规）
