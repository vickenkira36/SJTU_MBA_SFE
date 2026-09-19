# -*- coding: utf-8 -*-
"""
scripts/build-defense-ppt.py — 生成中期答辩 PPT

依据 ths-ppt skill 的 pptx_lib + 交大模板组装 14 页，对应已确认的大纲。
官方硬性要求：文件与陈述全程不得出现导师姓名，个人陈述 10-15 分钟。

图料来源：
  - docs/figures/*.png        论文原图（高分辨率，优于从 PDF 抽）
  - docs/答辩/figs/模型P.png   由 thesis.pdf 第 62 页裁出的公式 (4-10)(4-11) 合成图

用法：python3 scripts/build-defense-ppt.py
"""

import sys
from pathlib import Path

SKILL = Path('/tmp/thsppt/ths-ppt')
sys.path.insert(0, str(SKILL / 'scripts'))

from pptx_lib import Deck, card_grid, numbered_blocks, styled_table, RED, RED2, GRAY  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TPL = SKILL / 'assets' / '交大论文模板_通用版.pptx'
FIG = ROOT / 'docs' / 'figures'
DFIG = ROOT / 'docs' / '答辩' / 'figs'
OUT = ROOT / 'docs' / '答辩' / '中期答辩PPT-陈一.pptx'

TITLE = '运筹优化算法在药企\nSFE 辖区分配中的应用研究'


def main():
    d = Deck(str(TPL))

    # 1 封面 —— 不得出现导师姓名
    d.add_cover(TITLE, subtitle='MBA 学位论文中期答辩',
                presenter_date='汇报人：陈一          学号：124120935584')

    # 2 目录
    d.add_toc(['研究背景与问题', '行业调研验证', '模型与算法',
               '实证分析', '管理与商业化', '进展与计划'])

    # 3 研究背景
    d.add_chart_page('研究背景：从增量扩张到存量博弈',
                     str(FIG / 'fig3-3.png'),
                     '六年销售额 +50%\n一线人数 −8%\n\n增长不再靠加人')

    # 4 问题定位
    s = d.add_content('问题：数据丰富，算法贫乏', [])
    card_grid(s, [
        ('政策三重压力', '集采常态化、医保谈判机制化、\n反腐深水化，持续压缩利润空间'),
        ('工具停留在手工', '多数企业靠 Excel 博弈，\n决策周期 4-8 周'),
        ('商业 SaaS 水土不服', '国际套件难适配中国\n高度非标的业务规则'),
        ('低频但高影响', '牵动队伍稳定性、客户连续性\n与总部资源配置'),
    ], cols=2)

    # 5 行业调研
    d.add_chart_page('行业调研：12 位从业者的量化锚点',
                     str(FIG / 'fig3-6.png'),
                     '14 题问卷 + 半结构化访谈\n\n收敛出 Index 构成、\n维度排序、阈值容忍带、\n算法接受度四类锚点')

    # 6 优化模型（老师明确要求的整体数学规划形式）
    d.add_single_image('优化模型 (P)：目标与约束的整体形式', str(DFIG / '模型P.png'))

    # 7 两阶段算法架构
    d.add_single_image('两阶段解耦算法架构', str(FIG / 'fig4-1.png'))

    # 8 实证设计与问题规模
    d.add_hypotheses_page('实证设计与问题规模', [
        ('样本', '医院 / 辖区', '决策变量', '约束数', '耗时'),
        ('上海（聚集型）', '99 / 19', '2,033', '563', '4.6 秒'),
        ('湖南（中等）', '60 / 16', '1,008', '143', '1.9 秒'),
        ('新疆（稀疏）', '35 / 10', '390', '149', '2.4 秒'),
    ])

    # 9 主样本结果
    d.add_chart_page('主样本结果：湖南',
                     str(FIG / 'fig5-1.png'),
                     'CV  44.3% → 18.3%\n半径  50.9 → 33.6 km\n保留率（Index）87.4%')

    # 10 三省横向对比
    d.add_hypotheses_page('三省横向对比与能力边界', [
        ('指标', '上海', '湖南', '新疆'),
        ('As-Is CV', '63.8%', '44.3%', '47.9%'),
        ('To-Be CV', '15.2%', '18.3%', '32.1%'),
        ('CV 改善', '76.2%', '58.7%', '33.0%'),
        ('半径压缩', '54.5%', '34.0%', '54.7%'),
        ('保留率（Index）', '62.9%', '87.4%', '82.1%'),
        ('落入 20% 可接受带', '是', '是', '否 — 能力边界'),
    ])

    # 11 单句：反直觉发现
    d.add_single_sentence('一个反直觉的发现',
                          'As-Is 失衡越深，算法重构越彻底，客户保留率相应分化')

    # 12 落地路径
    d.add_single_image('落地路径：人机协同三阶段', str(FIG / 'fig6-1.png'))

    # 13 不足与下一阶段
    s = d.add_content('研究不足与下一阶段计划', [])
    numbered_blocks(s, [
        '数据范围：单企业单时点，泛化性待检验',
        '实验设计：缺单阶段对照与聚类消融',
        '九月补实验：单阶段对照 / 随机初始解 / SA 零迭代基线',
        '十月完善：加厚文献综述、格式复核、预答辩',
    ], y0=1350000, y1=6250000)

    # 14 尾声
    d.add_finale()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    d.save(str(OUT))
    print(f'✅ {OUT}')
    print(f'   共 {len(d.prs.slides)} 页')


if __name__ == '__main__':
    main()
