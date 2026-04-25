import { NextRequest } from 'next/server';

const GEMINI_BASE_URL = 'https://us.aigw.galileo.roche.com/v1';
const GEMINI_MODEL = 'gemini-2.5-pro';

const SYSTEM_PROMPT = `你是一个专业的SFE（Sales Force Effectiveness）辖区分配专家。用户会用自然语言描述他们的辖区分配需求和约束条件，你需要理解需求并完成医院到辖区的分配。

基本规则：
1. 每家医院必须被分配到至少一个辖区
2. 所有辖区都必须有医院分配
3. 当一家医院的index>=1500时，可以按比例拆分到多个辖区（最多floor(index/1000)+1个），拆分比例之和必须为100%
4. index<1500的医院不允许拆分，只能分配给一个辖区
5. 地理位置相近的医院应优先分配到同一辖区

当用户要求你执行分配时，你的回复必须包含一个JSON对象，格式如下：
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
- hospitalId和territoryId必须使用输入数据中的原始ID
- 你可以在JSON前后添加解释文字，但JSON部分必须完整且可解析
- 如果用户只是在讨论或提问（没有要求执行分配），正常回答即可，不需要输出JSON`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, hospitals, territories, apiKey } = body;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请提供 Gemini API Key' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build hospital and territory data context
    const hospitalLines = hospitals.map((h: { id: string; inscode: string; insname: string; city: string; province: string; latitude: number; longitude: number; index: number; sales: number; potential: number }) =>
      `${h.id}|${h.inscode}|${h.insname}|${h.city}|${h.province}|${h.latitude}|${h.longitude}|${h.index}|${h.sales}|${h.potential}`
    );

    const territoryLines = territories.map((t: { id: string; trtyCode: string; rep: string }) =>
      `${t.id}|${t.trtyCode}|${t.rep}`
    );

    const totalIndex = hospitals.reduce((s: number, h: { index: number }) => s + h.index, 0);

    const dataContext = `当前数据：
医院总数：${hospitals.length}
辖区总数：${territories.length}
Index总值：${totalIndex.toFixed(1)}

辖区列表（ID|代码|代表）：
${territoryLines.join('\n')}

医院列表（ID|代码|名称|城市|省份|纬度|经度|index|销量|潜力）：
${hospitalLines.join('\n')}`;

    // Build messages array with system prompt and data context
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `以下是本次分配的数据：\n\n${dataContext}` },
      { role: 'assistant', content: '数据已收到，我已了解所有医院和辖区信息。请告诉我你的分配需求和约束条件。' },
      ...messages,
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 min for large datasets

    let response;
    try {
      response = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          messages: apiMessages,
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return new Response(JSON.stringify({ error: msg.includes('abort') ? '请求超时' : `连接失败: ${msg}` }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `Gemini API 错误 (${response.status}): ${errText.slice(0, 300)}` }), {
        status: response.status, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stream through
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(streamController) {
        const reader = response.body?.getReader();
        if (!reader) {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '无响应体' })}\n\n`));
          streamController.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              if (trimmed === 'data: [DONE]') {
                streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
                continue;
              }
              if (trimmed.startsWith('data: ')) {
                try {
                  const json = JSON.parse(trimmed.slice(6));
                  const delta = json.choices?.[0]?.delta?.content;
                  if (delta) {
                    streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
                  }
                } catch {
                  // Skip
                }
              }
            }
          }

          if (buffer.trim() && buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
            try {
              const json = JSON.parse(buffer.trim().slice(6));
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
              }
            } catch { /* skip */ }
          }

          streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Stream error' })}\n\n`));
        } finally {
          streamController.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : '请求失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
