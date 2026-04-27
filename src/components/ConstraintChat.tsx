'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, X, Tag, ArrowRight, MessageSquare, Lock } from 'lucide-react';
import { Hospital, Territory, Constraint, ChatMessage, PresetConstraint, RegionConstraintParams } from '@/types';
import { parseConstraintWithLLM, generateWelcomeMessage } from '@/lib/constraint-parser';
import RegionConstraintEditor from './RegionConstraintEditor';

interface ConstraintChatProps {
  hospitals: Hospital[];
  territories: Territory[];
  onConstraintsReady: (constraints: Constraint[], regionConstraints?: RegionConstraintParams[]) => void;
  onBack: () => void;
  initialConstraints?: Constraint[];
  hasHistoricalData?: boolean;
  initialRegionConstraints?: RegionConstraintParams[];
}

const CONSTRAINT_TYPE_LABELS: Record<string, string> = {
  balance: '数量均衡',
  index_range: 'Index范围',
  hospital_split: '医院拆分',
  split_count: 'AB岗拆分条件',
  split_ratio_sum: '比例加和',
  city_limit: '城市上限',
  sales: '销量均衡',
  potential: '潜力均衡',
  capacity: '医院上限',
  geographic: '地理约束',
  geographic_distance: '距离约束',
  assignment: '指定分配',
  grouping: '分组约束',
  historical_stability: '历史稳定性',
  exclusion: '互斥约束',
  custom: '自定义',
};

const CONSTRAINT_TYPE_COLORS: Record<string, string> = {
  balance: 'bg-blue-100 text-blue-700',
  index_range: 'bg-indigo-100 text-indigo-700',
  hospital_split: 'bg-amber-100 text-amber-700',
  split_count: 'bg-lime-100 text-lime-700',
  split_ratio_sum: 'bg-emerald-100 text-emerald-700',
  city_limit: 'bg-cyan-100 text-cyan-700',
  sales: 'bg-green-100 text-green-700',
  potential: 'bg-teal-100 text-teal-700',
  capacity: 'bg-orange-100 text-orange-700',
  geographic: 'bg-purple-100 text-purple-700',
  geographic_distance: 'bg-violet-100 text-violet-700',
  assignment: 'bg-red-100 text-red-700',
  grouping: 'bg-yellow-100 text-yellow-700',
  exclusion: 'bg-pink-100 text-pink-700',
  custom: 'bg-gray-100 text-gray-700',
};

function createPresetConstraints(): PresetConstraint[] {
  return [
    {
      id: 'preset-index-range',
      description: '每个辖区的index总值在800~1200范围内',
      type: 'index_range',
      value: 800,
      value2: 1200,
      priority: 'soft',
      threshold: 200,
      valid: true,
      isPreset: true,
      editable: true,
    },
    {
      id: 'preset-city-limit',
      description: '每个辖区最多覆盖3个城市',
      type: 'city_limit',
      value: 3,
      priority: 'soft',
      threshold: 1,
      valid: true,
      isPreset: true,
      editable: true,
    },
    {
      id: 'preset-capacity',
      description: '每个辖区最多15家医院',
      type: 'capacity',
      value: 15,
      priority: 'soft',
      threshold: 1,
      valid: true,
      isPreset: true,
      editable: true,
    },
  ];
}

export default function ConstraintChat({
  hospitals,
  territories,
  onConstraintsReady,
  onBack,
  initialConstraints,
  hasHistoricalData,
  initialRegionConstraints,
}: ConstraintChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>(() => {
    if (initialConstraints && initialConstraints.length > 0) {
      return initialConstraints;
    }
    const presets = createPresetConstraints();
    if (hasHistoricalData) {
      presets.push({
        id: 'preset-historical',
        description: '优先保持历史分配关系，变动index超过阈值时产生等量惩罚',
        type: 'historical_stability',
        value: 200,
        priority: 'soft',
        threshold: 200,
        valid: true,
        isPreset: true,
        editable: true,
      });
    }
    return presets;
  });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [regionConstraints, setRegionConstraints] = useState<RegionConstraintParams[]>(initialRegionConstraints || []);

  // Check if region data exists in territories
  const hasRegionData = territories.some((t) => t.region);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const welcome = generateWelcomeMessage(hospitals, territories);
    const presetSummary = initialConstraints && initialConstraints.length > 0
      ? '\n\n已恢复之前设置的约束条件。您可以继续调整或直接开始优化。'
      : '\n\n**已加载6条默认约束条件**（见右侧面板）。您可以直接点击「开始算法分配」，或通过对话调整约束数值。';
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: welcome + presetSummary,
        timestamp: new Date(),
      },
    ]);
  }, [hospitals, territories, initialConstraints]);

  useEffect(() => {
    // Scroll only within the chat container, not the entire page
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isTyping) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    const assistantMsgId = `msg-${Date.now()}-resp`;

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Add an empty assistant message that will be updated via streaming
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      },
    ]);

    try {
      const { constraint, response } = await parseConstraintWithLLM(
        userMessage.content,
        hospitals,
        territories,
        undefined,
        constraints,
        (chunk: string) => {
          // Update the assistant message content incrementally
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + chunk }
                : m
            )
          );
        }
      );

      // Final update with complete response and constraint
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: response, constraints: constraint ? [constraint] : undefined }
            : m
        )
      );

      if (constraint) {
        setConstraints((prev) => {
          // If the new constraint matches a preset type, replace the preset
          const existingPresetIdx = prev.findIndex(
            (c) => (c as PresetConstraint).isPreset && c.type === constraint.type
          );
          if (existingPresetIdx >= 0) {
            const updated = [...prev];
            updated[existingPresetIdx] = {
              ...constraint,
              id: prev[existingPresetIdx].id,
              isPreset: true,
              editable: true,
            } as PresetConstraint;
            return updated;
          }
          return [...prev, constraint];
        });
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: '⚠️ 处理请求时出错，请重试。' }
            : m
        )
      );
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, hospitals, territories, constraints]);

  const removeConstraint = useCallback((id: string) => {
    setConstraints((prev) => {
      const target = prev.find((c) => c.id === id);
      if (target && (target as PresetConstraint).isPreset && !(target as PresetConstraint).editable) {
        return prev;
      }
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  const handleThresholdChange = useCallback((constraintId: string, threshold: number) => {
    setConstraints((prev) =>
      prev.map((c) => (c.id === constraintId ? { ...c, threshold } : c))
    );
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickActions = [
    'index范围改为600到1000',
    '城市上限改为5个',
    '每个辖区最多20家医院',
    '辖区内医院最大距离改为500公里',
    '大index医院可以按比例拆分给多个辖区',
    '尽量让各辖区的销量差不多',
  ];

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex gap-6 h-[calc(100vh-480px)] min-h-[260px]">
      {/* Chat Panel */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Chat Header */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-blue-500" />
          <h3 className="font-semibold text-gray-800">约束条件对话</h3>
          <span className="text-xs text-gray-400 ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-600 rounded text-xs">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              GPT-5.2
            </span>
            {hospitals.length}家医院 · {territories.length}个辖区
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {msg.content.split('\n').map((line, i) => (
                    <span key={i}>
                      {line.startsWith('•') ? (
                        <span className="block ml-2">{line}</span>
                      ) : line.startsWith('**') ? (
                        <strong>{line.replace(/\*\*/g, '')}</strong>
                      ) : (
                        line
                      )}
                      {i < msg.content.split('\n').length - 1 && <br />}
                    </span>
                  ))}
                </div>
                {msg.constraints && msg.constraints.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {msg.constraints.map((c) => (
                      <div
                        key={c.id}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${CONSTRAINT_TYPE_COLORS[c.type] || 'bg-gray-100 text-gray-700'}`}
                      >
                        <Tag className="h-3 w-3" />
                        {CONSTRAINT_TYPE_LABELS[c.type] || c.type}：{c.description}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span>GPT-5.2 分析中...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-2 border-t border-gray-100 flex gap-2 overflow-x-auto">
          {quickActions.map((action, i) => (
            <button
              key={i}
              onClick={() => {
                setInput(action);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              className="flex-shrink-0 text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors"
            >
              {action}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="用自然语言描述或调整约束条件..."
              disabled={isTyping}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-gray-900 placeholder:text-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={`p-2.5 rounded-xl transition-colors ${
                input.trim() && !isTyping
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Constraints Sidebar */}
      <div className="w-72 flex flex-col">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="font-semibold text-gray-800 text-sm">
              约束条件 ({constraints.length})
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">默认约束可通过对话调整数值</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {constraints.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">
                通过对话添加约束条件
              </div>
            ) : (
              constraints.map((c) => {
                const isPreset = (c as PresetConstraint).isPreset;
                const isHardPreset = isPreset && !(c as PresetConstraint).editable;
                return (
                  <div
                    key={c.id}
                    className={`p-3 rounded-lg border group ${
                      isPreset
                        ? 'border-blue-100 bg-blue-50/50'
                        : 'border-gray-100 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1 mb-1">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CONSTRAINT_TYPE_COLORS[c.type] || 'bg-gray-100 text-gray-700'}`}
                          >
                            {CONSTRAINT_TYPE_LABELS[c.type] || c.type}
                          </span>
                          {isPreset && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-600">
                              {isHardPreset ? <Lock className="h-2.5 w-2.5" /> : null}
                              默认
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700">{c.description}</p>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs ${
                              c.priority === 'hard' ? 'text-red-500' : 'text-yellow-600'
                            }`}
                          >
                            {c.priority === 'hard' ? '硬约束' : '软约束'}
                          </span>
                          {c.priority !== 'hard' && c.threshold != null && (
                            <span className="text-xs text-gray-400">
                              阈值:{c.threshold}
                            </span>
                          )}
                        </div>
                      </div>
                      {!isHardPreset && (
                        <button
                          onClick={() => removeConstraint(c.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
      </div>

      {/* Divider: step 2 — combined threshold + region editor */}
      <div className="flex items-center gap-4 py-1">
        <div className="flex-1 border-t border-gray-200" />
        <span className="text-xs text-gray-400 shrink-0">▼ 第二步：设定约束参数与惩罚阈值</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>

      <RegionConstraintEditor
        hospitals={hospitals}
        territories={territories}
        constraints={constraints}
        onChange={setRegionConstraints}
        onThresholdChange={handleThresholdChange}
        initialParams={initialRegionConstraints}
        hasRegionData={hasRegionData}
      />

      {/* Action Buttons */}
      <div className="flex items-center gap-3 justify-center">
        <button
          onClick={onBack}
          className="px-6 py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors border border-gray-200 rounded-xl hover:bg-gray-50"
        >
          返回上一步
        </button>
        <button
          onClick={() => onConstraintsReady(constraints, hasRegionData ? regionConstraints : undefined)}
          className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-lg"
        >
          开始算法分配
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
