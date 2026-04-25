import { NextRequest } from 'next/server';

const API_URL = 'https://us.aigw.galileo.roche.com/v1/chat/completions';
const MODEL = 'gpt-5.2-2025-12-11';

const SYSTEM_PROMPT = `你是辖区分配约束解析器。将用户自然语言解析为JSON。

约束类型及字段：
- index_range: value(下限), value2(上限)
- hospital_split: value(阈值,0=自动)
- split_count: value(每家医院最少分配辖区数,默认1), value2(允许拆分的index阈值,默认1500,index>=此值时最多分配floor(index/1000)+1个辖区)
- split_ratio_sum: value(比例加和目标值，通常100)
- capacity: value(医院数上限)
- city_limit: value(城市数上限)
- balance: 医院数量均衡(无额外字段)
- sales: 销量均衡(无额外字段)
- potential: 潜力均衡(无额外字段)
- geographic: field("city"或"province")
- geographic_distance: value(同辖区内医院间最大距离,单位km)
- assignment: value(医院名), territoryField(辖区代码)
- exclusion: value(医院1名), territoryField(医院2名)

priority规则：强制语气(必须/不能/一定)=hard，柔性语气(尽量/希望/改为/调整)=soft，默认soft。
数字用数字类型，不用字符串。

重要：用户可能在调整已有约束的数值（如"index范围改为600到1000"），此时仍然输出对应类型的完整约束JSON。

回复要求：只输出一个JSON对象。不要用数组。不要用markdown代码块。不要输出任何解释文字。直接输出JSON。
示例输出：{"understood":true,"type":"capacity","description":"每个辖区最多15家","priority":"soft","value":15,"response":"已将医院上限调整为15家"}
调整已有约束示例：{"understood":true,"type":"index_range","description":"每个辖区的index总值在600~1000范围内","priority":"soft","value":600,"value2":1000,"response":"已将index范围调整为600~1000"}
无法理解时：{"understood":false,"response":"原因"}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userInput, dataContext, constraintsContext } = body;
    const apiKey = 'nJTvneF1ooX3+xzfNRA0Tt04Bp8i';

    if (!userInput) {
      return new Response(JSON.stringify({ error: '请提供约束描述' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let userMessage = '';
    if (dataContext) {
      userMessage += `当前数据上下文：\n${dataContext}\n\n`;
    }
    if (constraintsContext) {
      userMessage += `当前已设置的约束条件：\n${constraintsContext}\n\n`;
    }
    userMessage += `用户输入的约束条件：${userInput}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-portkey-api-key': apiKey,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      if (msg.includes('abort')) {
        return new Response(JSON.stringify({ error: '请求超时（30秒）' }), { status: 504, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `无法连接到 LLM API: ${msg}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('LLM API error:', response.status, errText);
      return new Response(JSON.stringify({ error: `LLM API 返回错误 (${response.status})` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stream SSE chunks from upstream to client
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(ctrl) {
        const reader = response.body?.getReader();
        if (!reader) {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '无响应体' })}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
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
                ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
                continue;
              }
              if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.slice(6);
                try {
                  const chunk = JSON.parse(jsonStr);
                  const delta = chunk.choices?.[0]?.delta?.content;
                  if (delta) {
                    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
                  }
                } catch {
                  // skip unparseable chunks
                }
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const chunk = JSON.parse(trimmed.slice(6));
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) {
                  ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
                }
              } catch { /* skip */ }
            }
          }

          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
        } finally {
          ctrl.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('Parse constraint error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : '解析失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
