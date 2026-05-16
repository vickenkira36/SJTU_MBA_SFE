import { NextRequest } from 'next/server';

const GEMINI_BASE_URL = 'https://eu.aigw.galileo.roche.com/v1';
const GEMINI_MODEL = 'eu.anthropic.claude-opus-4-7';

const SYSTEM_PROMPT = `你是一个专业的SFE（Sales Force Effectiveness）辖区分配专家。你的任务是将医院分配到销售辖区。

你必须严格遵守以下规则：
1. 每家医院必须被分配到至少一个辖区
2. 所有辖区都必须有医院分配
3. 约束条件按权重(weight)从高到低优先满足
4. index均衡是最重要的指标——每个辖区的index总值应尽量落在指定范围内
5. 地理位置相近的医院应尽量分配到同一辖区
6. 当一家医院的index>=1500时，可以按比例拆分到多个辖区（最多floor(index/1000)+1个），拆分比例之和必须为100%
7. index<1500的医院不允许拆分，只能分配给一个辖区

输出格式要求：
只输出一个JSON对象，格式如下：
{
  "assignments": [
    {"hospitalId": "H001", "territoryId": "T001", "splitRatio": 1.0},
    {"hospitalId": "H002", "territoryId": "T001", "splitRatio": 1.0},
    {"hospitalId": "H003", "territoryId": "T002", "splitRatio": 0.6},
    {"hospitalId": "H003", "territoryId": "T003", "splitRatio": 0.4}
  ]
}

注意：
- splitRatio为1.0表示100%分配给该辖区
- 拆分的医院会出现多行，splitRatio之和必须为1.0
- 不要输出任何解释文字，只输出JSON
- hospitalId和territoryId必须使用输入数据中的原始ID`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { hospitals, territories, constraints, apiKey, batchIndex, totalBatches } = body;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请提供 Gemini API Key' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const constraintText = constraints
      .sort((a: { weight?: number }, b: { weight?: number }) => (b.weight ?? 5) - (a.weight ?? 5))
      .map((c: { weight?: number; description: string; priority: string }) =>
        `- [权重${c.weight ?? 5}] ${c.description} (${c.priority === 'hard' ? '硬约束' : '软约束'})`
      )
      .join('\n');

    const hospitalLines = hospitals.map((h: { id: string; inscode: string; insname: string; city: string; province: string; latitude: number; longitude: number; index: number; sales: number; potential: number }) =>
      `${h.id}|${h.inscode}|${h.insname}|${h.city}|${h.province}|${h.latitude}|${h.longitude}|${h.index}|${h.sales}|${h.potential}`
    );

    const territoryLines = territories.map((t: { id: string; trtyCode: string; rep: string }) =>
      `${t.id}|${t.trtyCode}|${t.rep}`
    );

    const indexConstraint = constraints.find((c: { type: string }) => c.type === 'index_range');
    const indexMin = indexConstraint ? Number(indexConstraint.value) || 800 : 800;
    const indexMax = indexConstraint?.value2 ?? 1200;
    const totalIndex = hospitals.reduce((s: number, h: { index: number }) => s + h.index, 0);
    const avgIndex = territories.length > 0 ? totalIndex / territories.length : 0;

    let batchNote = '';
    if (batchIndex !== undefined && totalBatches !== undefined) {
      batchNote = `\n\n注意：这是第${batchIndex + 1}/${totalBatches}批数据。请只处理本批医院的分配。`;
    }

    const userMessage = `请将以下医院分配到辖区。

约束条件（按权重从高到低）：
${constraintText}

统计信息：
- 医院总数：${hospitals.length}
- 辖区总数：${territories.length}
- Index总值：${totalIndex.toFixed(1)}
- 目标每辖区Index：${indexMin}~${indexMax}（平均${avgIndex.toFixed(1)}）

辖区列表（ID|代码|代表）：
${territoryLines.join('\n')}

医院列表（ID|代码|名称|城市|省份|纬度|经度|index|销量|潜力）：
${hospitalLines.join('\n')}
${batchNote}

请输出JSON分配结果。`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    let response;
    try {
      response = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-portkey-api-key': apiKey,
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          max_tokens: 9000,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      if (msg.includes('abort')) {
        return new Response(JSON.stringify({ error: '请求超时（180秒）' }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: `无法连接到 LLM API: ${msg}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('LLM API error:', response.status, errText);
      return new Response(JSON.stringify({ error: `LLM API 错误 (${response.status}): ${errText.slice(0, 300)}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ content }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Assign territory error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : '分配失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
