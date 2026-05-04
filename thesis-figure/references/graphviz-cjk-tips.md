# Graphviz CJK Tips for Thesis Figures

## Known Issues in Graphviz 2.43.0

### 1. BALIGN="CENTER" is ignored

The `BALIGN` attribute on `<TD>` elements does not affect text alignment when using `<BR/>` tags.
Lines separated by `<BR/>` always left-align regardless of `BALIGN` setting.

**Workaround:** Replace `<BR/>`-separated text with a nested `<TABLE BORDER="0">` where each line
occupies its own `<TR><TD ALIGN="CENTER">` row. This forces per-line centering.

### 2. Font fallback

If `Noto Sans CJK SC` is not installed, Graphviz silently falls back to a Latin font,
rendering all CJK characters as empty boxes (tofu). Always verify the font is installed:

```bash
fc-list :lang=zh family | grep -i noto
```

Expected output: `Noto Sans CJK SC` (among others).

### 3. HTML entity escaping

In Graphviz HTML labels, these characters must be escaped:
- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`
- `"` inside attributes → use single quotes for the outer label delimiter, or escape

### 4. WIDTH attribute behavior

`WIDTH` on `<TD>` sets a minimum width, not a fixed width. If content is wider, the cell expands.
Use consistent `WIDTH` values across cells in the same row for uniform appearance.

### 5. Rendering at high DPI

Always use `dpi=300` for print-quality output. The default 96 DPI produces blurry figures
when embedded in Word documents at typical thesis page sizes.

### 6. Large diagrams

For diagrams with many nodes (>15), consider:
- Increasing `ranksep` to 0.5 or higher
- Using `compound=true` with subgraphs for logical grouping
- Splitting into multiple figures rather than one oversized diagram
