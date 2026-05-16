import { Constraint, ConstraintType, Hospital, Territory } from '@/types';

function makeId(): string {
  return `C${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildDataContext(hospitals: Hospital[], territories: Territory[]): string {
  const cities = [...new Set(hospitals.map((h) => h.city).filter(Boolean))];
  const provinces = [...new Set(hospitals.map((h) => h.province).filter(Boolean))];
  const totalIndex = hospitals.reduce((s, h) => s + h.index, 0);
  const maxIndex = Math.max(...hospitals.map((h) => h.index));
  const minIndex = Math.min(...hospitals.map((h) => h.index));

  const lines = [
    `医院数量: ${hospitals.length}家`,
    `辖区数量: ${territories.length}个`,
    `辖区列表: ${territories.map((t) => `${t.trtyCode}(${t.rep})`).join(', ')}`,
    `城市(${cities.length}个): ${cities.slice(0, 15).join(', ')}${cities.length > 15 ? '...' : ''}`,
    `省份: ${provinces.join(', ')}`,
    `Index范围: ${minIndex.toFixed(1)} ~ ${maxIndex.toFixed(1)}，总计: ${totalIndex.toFixed(1)}`,
    `医院名称示例: ${hospitals.slice(0, 8).map((h) => h.insname).join(', ')}`,
    `可用字段: inscode, insname, 城市(city), 省份(province), 销量(sales), 潜力(potential), 销量归一化(salesNorm), 潜力归一化(potentialNorm), index`,
  ];

  return lines.join('\n');
}

function buildConstraintsContext(constraints: Constraint[]): string {
  if (constraints.length === 0) return '';
  return constraints
    .map((c) => `- [${c.type}] ${c.description} (${c.priority === 'hard' ? '硬约束' : '软约束'})`)
    .join('\n');
}

// Extract the "response" field value from a partial JSON string being streamed
function extractPartialResponse(partial: string): string {
  // Try to find "response":"..." pattern and extract the value so far
  const match = partial.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)(")?/);
  if (match) {
    // Unescape JSON string escapes
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return match[1];
    }
  }
  return '';
}

export async function parseConstraintWithLLM(
  input: string,
  hospitals: Hospital[],
  territories: Territory[],
  _apiKey?: string,
  currentConstraints?: Constraint[],
  onChunk?: (text: string) => void
): Promise<{ constraint: Constraint | null; response: string }> {
  try {
    const dataContext = buildDataContext(hospitals, territories);
    const constraintsContext = currentConstraints
      ? buildConstraintsContext(currentConstraints)
      : '';

    const res = await fetch('/api/parse-constraint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userInput: input, dataContext, constraintsContext }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return {
        constraint: null,
        response: `⚠️ API调用失败: ${err.error || res.statusText}`,
      };
    }

    const resData = await res.json();
    if (resData.error) {
      return { constraint: null, response: `⚠️ ${resData.error}` };
    }

    const fullContent = resData.content || '';

    // 流式回调：一次性输出完整 response
    if (onChunk) {
      const partialResponse = extractPartialResponse(fullContent);
      if (partialResponse) onChunk(partialResponse);
    }

    // 解析完整 JSON
    let parsed;
    try {
      let jsonStr = fullContent.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      return {
        constraint: null,
        response: '⚠️ LLM 返回了无效的 JSON，请重试。',
      };
    }

    if (!parsed.understood) {
      return {
        constraint: null,
        response: parsed.response || '未能理解您的约束条件，请尝试换一种表达方式。',
      };
    }

    const validTypes: ConstraintType[] = [
      'balance', 'index_range', 'hospital_split', 'split_count',
      'split_ratio_sum', 'city_limit', 'capacity', 'geographic',
      'geographic_distance', 'assignment', 'grouping', 'exclusion',
      'sales', 'potential', 'custom',
    ];

    if (!validTypes.includes(parsed.type as ConstraintType)) {
      return {
        constraint: null,
        response: parsed.response || '解析结果类型无效，请重新描述。',
      };
    }

    // For assignment type, validate hospital and territory exist
    if (parsed.type === 'assignment') {
      const foundH = hospitals.find(
        (h) => parsed.value && (h.insname.includes(String(parsed.value)) || h.inscode === String(parsed.value))
      );
      const foundT = territories.find(
        (t) => parsed.territoryField && (t.trtyCode.includes(parsed.territoryField) || t.rep.includes(parsed.territoryField))
      );
      if (!foundH) {
        return {
          constraint: null,
          response: `⚠️ 未找到"${parsed.value}"对应的医院。当前清单中的医院有：${hospitals.slice(0, 5).map((h) => h.insname).join('、')}等。`,
        };
      }
      if (!foundT) {
        return {
          constraint: null,
          response: `⚠️ 未找到"${parsed.territoryField}"对应的辖区。当前辖区有：${territories.map((t) => `${t.trtyCode}(${t.rep})`).join('、')}。`,
        };
      }
      parsed.value = foundH.insname;
      parsed.territoryField = foundT.trtyCode;
    }

    // For exclusion type, validate both hospitals exist
    if (parsed.type === 'exclusion') {
      const h1 = hospitals.find(
        (h) => parsed.value && (h.insname.includes(String(parsed.value)) || h.inscode === String(parsed.value))
      );
      const h2 = hospitals.find(
        (h) => parsed.territoryField && (h.insname.includes(parsed.territoryField) || h.inscode === parsed.territoryField)
      );
      if (!h1) {
        return { constraint: null, response: `⚠️ 未找到"${parsed.value}"对应的医院。` };
      }
      if (!h2) {
        return { constraint: null, response: `⚠️ 未找到"${parsed.territoryField}"对应的医院。` };
      }
      parsed.value = h1.insname;
      parsed.territoryField = h2.insname;
    }

    const constraint: Constraint = {
      id: makeId(),
      description: parsed.description || input,
      type: parsed.type as ConstraintType,
      priority: parsed.priority === 'soft' ? 'soft' : 'hard',
      valid: true,
      field: parsed.field || undefined,
      value: parsed.value ?? undefined,
      value2: parsed.value2 ?? undefined,
      territoryField: parsed.territoryField || undefined,
    };

    return {
      constraint,
      response: parsed.response || `已理解：${constraint.description}`,
    };
  } catch (err) {
    return {
      constraint: null,
      response: `⚠️ 解析出错: ${err instanceof Error ? err.message : '未知错误'}`,
    };
  }
}

export function generateWelcomeMessage(hospitals: Hospital[], territories: Territory[]): string {
  const totalIndex = hospitals.reduce((s, h) => s + h.index, 0);
  const avgIndex = territories.length > 0 ? totalIndex / territories.length : 0;
  const maxIndex = Math.max(...hospitals.map((h) => h.index));
  const cities = new Set(hospitals.map((h) => h.city).filter(Boolean));

  return `数据已加载完成！\n\n**数据概览：**\n• 医院数量：${hospitals.length} 家（覆盖${cities.size}个城市）\n• 辖区数量：${territories.length} 个\n• Index总值：${totalIndex.toFixed(1)}，平均每辖区：${avgIndex.toFixed(1)}\n• 单家医院最大Index：${maxIndex.toFixed(1)}\n\n请用自然语言描述您的约束条件，例如：\n• "index范围改为600到1000"\n• "城市上限改为5个"\n• "每个辖区最多20家医院"\n• "大index医院可以按比例拆分给多个辖区"\n• "尽量让各辖区的销量差不多"`;
}
