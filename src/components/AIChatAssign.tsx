'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Key, Eye, EyeOff, Brain, ArrowLeft, Loader2 } from 'lucide-react';
import { Hospital, Territory, OptimizationResult, TerritoryResult, Assignment } from '@/types';

interface AIChatAssignProps {
  hospitals: Hospital[];
  territories: Territory[];
  onResult: (result: OptimizationResult) => void;
  onBack: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

function buildDataSummary(hospitals: Hospital[], territories: Territory[]): string {
  const totalIndex = hospitals.reduce((s, h) => s + h.index, 0);
  const avgIndex = territories.length > 0 ? totalIndex / territories.length : 0;
  const cities = new Set(hospitals.map((h) => h.city).filter(Boolean));
  const provinces = new Set(hospitals.map((h) => h.province).filter(Boolean));
  const maxIndex = Math.max(...hospitals.map((h) => h.index));
  const minIndex = Math.min(...hospitals.map((h) => h.index));

  return `数据概览：
• 医院：${hospitals.length}家（覆盖${provinces.size}个省份、${cities.size}个城市）
• 辖区：${territories.length}个
• Index范围：${minIndex.toFixed(1)} ~ ${maxIndex.toFixed(1)}，总计${totalIndex.toFixed(1)}，平均每辖区${avgIndex.toFixed(1)}
• 辖区列表：${territories.map((t) => `${t.trtyCode}(${t.rep})`).join(', ')}`;
}

function buildHospitalData(hospitals: Hospital[]): string {
  return hospitals.map((h) =>
    `${h.id}|${h.inscode}|${h.insname}|${h.city}|${h.province}|${h.latitude}|${h.longitude}|${h.index}|${h.sales}|${h.potential}`
  ).join('\n');
}

function buildTerritoryData(territories: Territory[]): string {
  return territories.map((t) => `${t.id}|${t.trtyCode}|${t.rep}`).join('\n');
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(a)) * R;
}

function parseAssignmentResult(
  content: string,
  hospitals: Hospital[],
  territories: Territory[]
): OptimizationResult | null {
  // Try to extract JSON from the response
  let jsonStr = content.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  if (!jsonStr.startsWith('{')) {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) jsonStr = match[0];
    else return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  if (!parsed.assignments || !Array.isArray(parsed.assignments)) return null;

  const hospitalMap = new Map(hospitals.map((h) => [h.id, h]));
  const territoryMap = new Map(territories.map((t) => [t.id, t]));

  const trData = new Map<string, { assignments: Assignment[]; hospitals: Hospital[]; ratios: Map<string, number> }>();
  for (const t of territories) {
    trData.set(t.id, { assignments: [], hospitals: [], ratios: new Map() });
  }

  for (const a of parsed.assignments) {
    if (!a.hospitalId || !a.territoryId) continue;
    const hospital = hospitalMap.get(a.hospitalId);
    const territory = territoryMap.get(a.territoryId);
    if (!hospital || !territory) continue;

    const ratio = a.splitRatio ?? 1.0;
    const td = trData.get(a.territoryId);
    if (!td) continue;

    td.assignments.push({
      hospitalId: a.hospitalId,
      hospitalName: hospital.insname,
      territoryId: a.territoryId,
      territoryName: territory.trtyCode,
      productGroup: hospital.productGroup || '',
      splitRatio: ratio < 0.999 ? ratio : undefined,
    });
    if (!td.ratios.has(hospital.id)) {
      td.hospitals.push(hospital);
    }
    td.ratios.set(hospital.id, (td.ratios.get(hospital.id) || 0) + ratio);
  }

  const territoryResults: TerritoryResult[] = territories.map((t) => {
    const td = trData.get(t.id)!;
    const cities = new Set(td.hospitals.map((h) => h.city).filter(Boolean));
    return {
      territory: t,
      hospitals: td.hospitals,
      assignments: td.assignments,
      totalIndex: td.hospitals.reduce((s, h) => s + h.index * (td.ratios.get(h.id) ?? 1), 0),
      totalSales: td.hospitals.reduce((s, h) => s + h.sales * (td.ratios.get(h.id) ?? 1), 0),
      totalPotential: td.hospitals.reduce((s, h) => s + h.potential * (td.ratios.get(h.id) ?? 1), 0),
      hospitalCount: td.hospitals.length,
      cityCount: cities.size,
    };
  });

  const allAssignments = territoryResults.flatMap((tr) => tr.assignments);
  const assignedCount = new Set(allAssignments.map((a) => a.hospitalId)).size;
  const score = hospitals.length > 0 ? (assignedCount / hospitals.length) * 100 : 0;

  return {
    assignments: allAssignments,
    territoryResults,
    score,
    constraintsSatisfied: 0,
    constraintsTotal: 0,
    details: [`AI 分配完成：${assignedCount}/${hospitals.length}家医院已分配`],
    productGroup: '',
  };
}

export default function AIChatAssign({ hospitals, territories, onResult, onBack }: AIChatAssignProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [pendingResult, setPendingResult] = useState<OptimizationResult | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('gemini-api-key');
    if (saved) {
      setApiKey(saved);
      setApiKeySet(true);
    }
  }, []);

  useEffect(() => {
    if (apiKeySet && messages.length === 0) {
      const summary = buildDataSummary(hospitals, territories);
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `数据已加载！\n\n${summary}\n\n请用自然语言描述你的辖区分配需求，例如：\n• "请帮我把这些医院分配到各辖区，每个辖区的index总值控制在800到1200之间，同一辖区的医院距离不超过200公里"\n• "按地理位置就近分配，每个辖区不超过3个城市，大index医院可以拆分"\n• "均衡分配，优先保证index平衡，其次考虑地理距离"\n\n你可以一次性描述所有要求，我会直接给出分配结果。`,
        timestamp: new Date(),
      }]);
    }
  }, [apiKeySet, hospitals, territories, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSaveApiKey = useCallback(() => {
    if (!apiKey.trim()) return;
    localStorage.setItem('gemini-api-key', apiKey.trim());
    setApiKeySet(true);
  }, [apiKey]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    try {
      // Build conversation history for context
      const conversationHistory = [...messages, userMsg]
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/ai-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationHistory,
          hospitals: hospitals.map((h) => ({
            id: h.id, inscode: h.inscode, insname: h.insname,
            city: h.city, province: h.province,
            latitude: h.latitude, longitude: h.longitude,
            index: h.index, sales: h.sales, potential: h.potential,
          })),
          territories: territories.map((t) => ({
            id: t.id, trtyCode: t.trtyCode, rep: t.rep,
          })),
          apiKey,
        }),
      });

      const contentType = res.headers.get('content-type') || '';

      if (!res.ok || !contentType.includes('text/event-stream')) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `API 错误 ${res.status}`);
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无响应体');

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.error) throw new Error(data.error);
              if (data.content) {
                fullContent += data.content;
                setStreamingContent(fullContent);
              }
            } catch (e) {
              if (e instanceof Error && !e.message.includes('JSON')) throw e;
            }
          }
        }
      }

      reader.releaseLock();

      // Add assistant message
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-resp`,
        role: 'assistant',
        content: fullContent,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingContent('');

      // Try to parse assignment result
      const result = parseAssignmentResult(fullContent, hospitals, territories);
      if (result && result.assignments.length > 0) {
        setPendingResult(result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setMessages((prev) => [...prev, {
        id: `msg-${Date.now()}-err`,
        role: 'assistant',
        content: `⚠️ 请求失败: ${msg}`,
        timestamp: new Date(),
      }]);
      setStreamingContent('');
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, hospitals, territories, apiKey]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // API Key screen
  if (!apiKeySet) {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <div className="text-center mb-6">
            <Key className="mx-auto h-12 w-12 text-purple-500 mb-3" />
            <h3 className="text-lg font-semibold text-gray-900">配置 Gemini API</h3>
            <p className="text-sm text-gray-500 mt-2">AI 分配模式使用 Gemini 2.5 Pro</p>
          </div>
          <div className="space-y-4">
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                placeholder="Gemini API Key"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm text-gray-900 placeholder:text-gray-400 pr-10"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button
              onClick={handleSaveApiKey}
              disabled={!apiKey.trim()}
              className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                apiKey.trim() ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-200 text-gray-400'
              }`}
            >
              确认并继续
            </button>
          </div>
          <div className="mt-4 text-center">
            <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">返回上一步</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-220px)]">
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 bg-purple-50 flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold text-purple-800">AI 智能分配</h3>
          <span className="text-xs text-purple-400 ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-600 rounded text-xs">
              <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
              Gemini 2.5 Pro
            </span>
            {hospitals.length}家医院 · {territories.length}个辖区
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-800'
              }`}>
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

          {/* Streaming content */}
          {isStreaming && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-gray-100 text-gray-800">
                <div className="text-sm whitespace-pre-wrap leading-relaxed font-mono">
                  {streamingContent.length > 2000
                    ? '...' + streamingContent.slice(-2000)
                    : streamingContent}
                  <span className="animate-pulse text-purple-500">|</span>
                </div>
              </div>
            </div>
          )}

          {isStreaming && !streamingContent && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                  <span>Gemini 正在分析和分配...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Result action bar */}
        {pendingResult && !isStreaming && (
          <div className="px-4 py-3 border-t border-purple-100 bg-purple-50 flex items-center justify-between">
            <div className="text-sm text-purple-700">
              AI 已完成分配（{pendingResult.assignments.length}条分配记录）
            </div>
            <button
              onClick={() => onResult(pendingResult)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
            >
              查看分配结果 →
            </button>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述你的分配需求和约束条件..."
              disabled={isStreaming}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm text-gray-900 placeholder:text-gray-400 disabled:bg-gray-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className={`p-2.5 rounded-xl transition-colors ${
                input.trim() && !isStreaming
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft className="h-3 w-3" />
              返回选择
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
