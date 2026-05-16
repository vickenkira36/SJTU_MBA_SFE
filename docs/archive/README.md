# Archive — 历史章节文件

这里的 `chapter01.md`-`chapter04.md` 是论文整合到 BibTeX + 单源 `thesis.md` **之前**的章节版本（commit a9372c2 时刻的快照）。

## 不要编辑这些文件

论文当前的唯一写作源是 [`docs/thesis.md`](../thesis.md)。**改动这些归档文件不会反映到最终的 thesis.docx 里**——它们只是历史备份，留作万一需要回退时的参考。

## 这些文件和 thesis.md 的差异

| 维度 | 这里的 chapterXX.md | thesis.md |
|---|---|---|
| 引用格式 | `[N]` 数字 | `[@key]` BibTeX 键 |
| 参考文献列表 | 每章末尾手写 | 由 pandoc citeproc 自动生成 |
| Kuhn 1955 / Kirkpatrick 1983 | 缺正文引用 | 已补 |

## 如何完全回退到归档版本

```bash
git reset --hard a9372c2
```

这会把整个仓库回到 BibTeX 迁移前的状态。
