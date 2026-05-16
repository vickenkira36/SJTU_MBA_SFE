import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const apiKey = 'x+QB4FtRwyBQwQMlie5WxTtsK9g5';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://eu.aigw.galileo.roche.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-portkey-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'eu.anthropic.claude-opus-4-7',
        max_tokens: 100,
        messages: [{ role: 'user', content: '回复OK' }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({
        success: false,
        error: `API 返回 ${response.status}: ${text.slice(0, 200)}`,
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return NextResponse.json({
      success: true,
      message: `连接成功！模型回复: ${content}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      return NextResponse.json({
        success: false,
        error: '连接超时（15秒）。可能原因：1) 网络无法访问 eu.aigw.galileo.roche.com  2) API Key 无效',
      });
    }
    return NextResponse.json({
      success: false,
      error: `连接失败: ${msg}`,
    });
  }
}
