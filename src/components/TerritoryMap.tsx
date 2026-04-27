'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { OptimizationResult, Hospital, Territory } from '@/types';
import { MapPin, ChevronLeft, ChevronRight } from 'lucide-react';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#EF4444', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#0EA5E9', '#A855F7', '#22C55E',
  '#D946EF', '#0D9488', '#DC2626', '#2563EB', '#7C3AED',
  '#DB2777', '#CA8A04', '#059669', '#E11D48', '#0284C7',
  '#9333EA', '#16A34A', '#EA580C', '#4F46E5', '#0891B2',
  '#65A30D',
];

// Drill-down levels
type DrillLevel = 'country' | 'province' | 'lel' | 'rep';

interface TerritoryMapProps {
  result: OptimizationResult;
  hospitals: Hospital[];
  territories: Territory[];
}

interface ProvinceInfo {
  name: string;
  hospitalCount: number;
  territoryCount: number;
  bounds: L.LatLngBounds;
}

export default function TerritoryMap({ result, hospitals, territories }: TerritoryMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [drillLevel, setDrillLevel] = useState<DrillLevel>('country');
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [selectedLel, setSelectedLel] = useState<string | null>(null);
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Valid hospitals with coordinates
  const validHospitals = useMemo(() => {
    return hospitals.filter((h) => h.latitude && h.longitude);
  }, [hospitals]);

  // Hospital -> territory mapping
  const hospitalTerritoryMap = useMemo(() => {
    const map = new Map<string, { territoryId: string; territoryName: string; colorIndex: number }>();
    const territoryIndexMap = new Map(territories.map((t, i) => [t.id, i]));

    for (const a of result.assignments) {
      const tIdx = territoryIndexMap.get(a.territoryId) ?? 0;
      if (!a.splitRatio || a.splitRatio >= 0.999) {
        map.set(a.hospitalId, {
          territoryId: a.territoryId,
          territoryName: a.territoryName,
          colorIndex: tIdx,
        });
      }
      map.set(`${a.hospitalId}-${a.territoryId}`, {
        territoryId: a.territoryId,
        territoryName: a.territoryName,
        colorIndex: tIdx,
      });
    }
    return map;
  }, [result, territories]);

  // Province data with bounds
  const provinceData = useMemo(() => {
    const byProvince = new Map<string, Hospital[]>();
    for (const h of validHospitals) {
      const p = h.province || '未知';
      if (!byProvince.has(p)) byProvince.set(p, []);
      byProvince.get(p)!.push(h);
    }

    const territoryByProvince = new Map<string, number>();
    for (const t of territories) {
      const p = t.province || '未知';
      territoryByProvince.set(p, (territoryByProvince.get(p) || 0) + 1);
    }

    const provinces: ProvinceInfo[] = [];
    for (const [name, hs] of byProvince) {
      const lats = hs.map((h) => h.latitude);
      const lngs = hs.map((h) => h.longitude);
      const bounds = L.latLngBounds(
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)]
      );
      provinces.push({
        name,
        hospitalCount: hs.length,
        territoryCount: territoryByProvince.get(name) || 0,
        bounds,
      });
    }

    return provinces.sort((a, b) => b.hospitalCount - a.hospitalCount);
  }, [validHospitals, territories]);

  // Full bounds
  const fullBounds = useMemo(() => {
    if (validHospitals.length === 0) return null;
    return L.latLngBounds(
      validHospitals.map((h) => [h.latitude, h.longitude] as [number, number])
    );
  }, [validHospitals]);

  // LEL data for selected province
  const lelData = useMemo(() => {
    if (!selectedProvince) return [];
    const provTerritories = territories.filter((t) => t.province === selectedProvince);
    const lelMap = new Map<string, { lel: string; territories: Territory[]; hospitalCount: number }>();

    for (const t of provTerritories) {
      const lel = t.lel || '未分配';
      if (!lelMap.has(lel)) lelMap.set(lel, { lel, territories: [], hospitalCount: 0 });
      lelMap.get(lel)!.territories.push(t);
    }

    // Count hospitals per LEL
    for (const [, info] of lelMap) {
      const tIds = new Set(info.territories.map((t) => t.id));
      info.hospitalCount = result.assignments.filter((a) => tIds.has(a.territoryId)).length;
    }

    return Array.from(lelMap.values()).sort((a, b) => b.hospitalCount - a.hospitalCount);
  }, [selectedProvince, territories, result]);

  // Rep (territory) data for selected LEL
  const repData = useMemo(() => {
    if (!selectedProvince || !selectedLel) return [];
    const filtered = result.territoryResults.filter((tr) => {
      return tr.territory.province === selectedProvince &&
        (tr.territory.lel || '未分配') === selectedLel;
    });

    return filtered.map((tr) => {
      const tIdx = territories.findIndex((t) => t.id === tr.territory.id);
      return {
        id: tr.territory.id,
        name: tr.territory.trtyCode,
        rep: tr.territory.rep,
        color: COLORS[(tIdx >= 0 ? tIdx : 0) % COLORS.length],
        hospitalCount: tr.hospitalCount,
        index: tr.totalIndex,
      };
    }).sort((a, b) => b.index - a.index);
  }, [result, territories, selectedProvince, selectedLel]);

  // Determine which territory IDs are "active" for map filtering
  const activeTerritoryIds = useMemo(() => {
    if (selectedTerritory) return new Set([selectedTerritory]);
    if (selectedLel && selectedProvince) {
      const tIds = territories
        .filter((t) => t.province === selectedProvince && (t.lel || '未分配') === selectedLel)
        .map((t) => t.id);
      return new Set(tIds);
    }
    if (selectedProvince) {
      const tIds = territories.filter((t) => t.province === selectedProvince).map((t) => t.id);
      return new Set(tIds);
    }
    return null; // show all
  }, [selectedProvince, selectedLel, selectedTerritory, territories]);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    if (validHospitals.length === 0) return;

    const map = L.map(mapRef.current, {
      center: [35, 105],
      zoom: 4,
      scrollWheelZoom: true,
      zoomControl: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      attribution: '&copy; 高德地图',
      maxZoom: 18,
      subdomains: '1234',
    }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
    leafletMap.current = map;

    if (fullBounds) {
      map.fitBounds(fullBounds, { padding: [40, 40] });
    }

    return () => {
      map.remove();
      leafletMap.current = null;
      markersRef.current = null;
    };
  }, [validHospitals, fullBounds]);

  // Render markers
  useEffect(() => {
    const map = leafletMap.current;
    const markers = markersRef.current;
    if (!map || !markers) return;

    markers.clearLayers();

    const hospitalsToShow = selectedProvince
      ? validHospitals.filter((h) => h.province === selectedProvince)
      : validHospitals;

    for (const h of hospitalsToShow) {
      const info = hospitalTerritoryMap.get(h.id);
      if (!info) continue;

      const isHighlighted = !activeTerritoryIds || activeTerritoryIds.has(info.territoryId);
      const color = COLORS[info.colorIndex % COLORS.length];

      const baseSize = selectedProvince ? 14 : 10;
      const size = isHighlighted ? baseSize : baseSize - 3;
      const opacity = isHighlighted ? 1 : 0.2;

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:${size}px;height:${size}px;
          border-radius:50%;
          background:${color};
          border:2px solid white;
          box-shadow:0 1px 4px rgba(0,0,0,0.3);
          opacity:${opacity};
          transition: all 0.2s;
          cursor:pointer;
        "></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([h.latitude, h.longitude], { icon });
      marker.bindPopup(`
        <div style="font-size:13px;line-height:1.7;min-width:160px">
          <strong style="font-size:14px">${h.insname}</strong><br/>
          <span style="color:#888">${h.province} · ${h.city}</span><br/>
          Index: <strong style="color:#3B82F6">${h.index.toFixed(1)}</strong><br/>
          销量: ${h.sales ? h.sales.toLocaleString() : '-'} &nbsp;
          潜力: ${h.potential ? h.potential.toLocaleString() : '-'}<br/>
          辖区: <span style="
            background:${color};color:white;
            padding:2px 8px;border-radius:4px;font-size:11px;
          ">${info.territoryName}</span>
        </div>
      `);
      markers.addLayer(marker);
    }
  }, [validHospitals, hospitalTerritoryMap, selectedProvince, activeTerritoryIds]);

  // Zoom based on drill level
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    if (selectedProvince) {
      const prov = provinceData.find((p) => p.name === selectedProvince);
      if (prov) {
        map.flyToBounds(prov.bounds, { padding: [50, 50], duration: 0.8 });
      }
    } else if (fullBounds) {
      map.flyToBounds(fullBounds, { padding: [40, 40], duration: 0.8 });
    }
  }, [selectedProvince, provinceData, fullBounds]);

  // Navigation handlers
  const drillDown = useCallback((level: DrillLevel, value: string) => {
    switch (level) {
      case 'province':
        setSelectedProvince(value);
        setSelectedLel(null);
        setSelectedTerritory(null);
        setDrillLevel('province');
        break;
      case 'lel':
        setSelectedLel(value);
        setSelectedTerritory(null);
        setDrillLevel('lel');
        break;
      case 'rep':
        setSelectedTerritory(value);
        setDrillLevel('rep');
        break;
    }
  }, []);

  const drillUp = useCallback(() => {
    switch (drillLevel) {
      case 'province':
        setSelectedProvince(null);
        setSelectedLel(null);
        setSelectedTerritory(null);
        setDrillLevel('country');
        break;
      case 'lel':
        setSelectedLel(null);
        setSelectedTerritory(null);
        setDrillLevel('province');
        break;
      case 'rep':
        setSelectedTerritory(null);
        setDrillLevel('lel');
        break;
    }
  }, [drillLevel]);

  // Breadcrumb
  const breadcrumb = useMemo(() => {
    const items: { label: string; level: DrillLevel; value?: string }[] = [
      { label: '全国', level: 'country' },
    ];
    if (selectedProvince) {
      items.push({ label: selectedProvince, level: 'province', value: selectedProvince });
    }
    if (selectedLel) {
      items.push({ label: `LEL: ${selectedLel}`, level: 'lel', value: selectedLel });
    }
    if (selectedTerritory) {
      const rep = repData.find((r) => r.id === selectedTerritory);
      items.push({ label: rep ? `${rep.name} (${rep.rep})` : selectedTerritory, level: 'rep', value: selectedTerritory });
    }
    return items;
  }, [selectedProvince, selectedLel, selectedTerritory, repData]);

  if (validHospitals.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-2 text-gray-400">
          <MapPin className="h-5 w-5" />
          <span>无可用经纬度数据，无法显示地图</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      {/* Header with breadcrumb */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 text-sm">
          <span className="font-semibold text-gray-700">辖区地图分布</span>
          <span className="text-gray-300 mx-1">|</span>
          {breadcrumb.map((item, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={item.level} className="flex items-center">
                {i > 0 && <span className="text-gray-300 mx-1">/</span>}
                {isLast ? (
                  <span className="text-blue-600 font-medium">{item.label}</span>
                ) : (
                  <button
                    onClick={() => {
                      // Navigate to this level
                      if (item.level === 'country') {
                        setSelectedProvince(null);
                        setSelectedLel(null);
                        setSelectedTerritory(null);
                        setDrillLevel('country');
                      } else if (item.level === 'province') {
                        setSelectedLel(null);
                        setSelectedTerritory(null);
                        setDrillLevel('province');
                      } else if (item.level === 'lel') {
                        setSelectedTerritory(null);
                        setDrillLevel('lel');
                      }
                    }}
                    className="text-gray-500 hover:text-blue-600 transition-colors"
                  >
                    {item.label}
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {drillLevel !== 'country' && (
          <button
            onClick={drillUp}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回上级
          </button>
        )}
      </div>

      <div className="flex gap-4">
        {/* Sidebar */}
        <div className={`flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-8' : 'w-56'}`}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center py-1 mb-2 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-50"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          {!sidebarCollapsed && (
            <>
              {/* Level 1: Province list */}
              {drillLevel === 'country' && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 font-medium">
                    省份（点击下钻）
                  </div>
                  <div className="max-h-[460px] overflow-y-auto space-y-0.5 pr-1">
                    {provinceData.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => drillDown('province', p.name)}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all hover:bg-blue-50 hover:text-blue-700 group flex items-center justify-between"
                      >
                        <span className="font-medium text-gray-700 group-hover:text-blue-700">
                          {p.name}
                        </span>
                        <span className="text-gray-400 group-hover:text-blue-500 tabular-nums">
                          {p.hospitalCount}家 · {p.territoryCount}区
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Level 2: LEL list */}
              {drillLevel === 'province' && selectedProvince && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 font-medium">
                    LEL（点击下钻）
                  </div>
                  <div className="max-h-[460px] overflow-y-auto space-y-0.5 pr-1">
                    {lelData.map((item) => (
                      <button
                        key={item.lel}
                        onClick={() => drillDown('lel', item.lel)}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all hover:bg-blue-50 hover:text-blue-700 group flex items-center justify-between"
                      >
                        <span className="font-medium text-gray-700 group-hover:text-blue-700 truncate">
                          {item.lel}
                        </span>
                        <span className="text-gray-400 group-hover:text-blue-500 tabular-nums flex-shrink-0 ml-2">
                          {item.hospitalCount}家 · {item.territories.length}区
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Level 3: Rep (territory) list */}
              {drillLevel === 'lel' && selectedLel && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 font-medium">
                    Rep / 辖区（点击筛选）
                  </div>
                  <div className="max-h-[460px] overflow-y-auto space-y-0.5 pr-1">
                    <button
                      onClick={() => setSelectedTerritory(null)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                        selectedTerritory === null
                          ? 'bg-gray-100 font-semibold text-gray-800'
                          : 'hover:bg-gray-50 text-gray-500'
                      }`}
                    >
                      全部辖区
                    </button>

                    {repData.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => drillDown('rep', item.id)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all flex items-center gap-2 ${
                          selectedTerritory === item.id
                            ? 'bg-gray-100 font-semibold'
                            : selectedTerritory !== null
                            ? 'opacity-40 hover:opacity-70'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <span
                          className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-gray-700 truncate">{item.name}</div>
                          <div className="text-gray-400 truncate text-[10px]">{item.rep}</div>
                        </div>
                        <span className="text-gray-400 flex-shrink-0 tabular-nums">
                          {item.hospitalCount}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Level 4: Selected rep detail */}
              {drillLevel === 'rep' && selectedTerritory && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 font-medium">
                    当前辖区
                  </div>
                  <div className="max-h-[460px] overflow-y-auto space-y-0.5 pr-1">
                    {repData.filter((r) => r.id === selectedTerritory).map((item) => (
                      <div
                        key={item.id}
                        className="px-2.5 py-3 rounded-lg bg-blue-50 border border-blue-200"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-sm font-semibold text-gray-800">{item.name}</span>
                        </div>
                        <div className="space-y-1 text-xs text-gray-600">
                          <div>Rep: {item.rep}</div>
                          <div>医院数: {item.hospitalCount}</div>
                          <div>Index: {item.index.toFixed(0)}</div>
                        </div>
                      </div>
                    ))}

                    {/* Show other reps in same LEL for quick switching */}
                    <div className="text-xs text-gray-400 mt-3 mb-1 font-medium">同组其他辖区</div>
                    {repData.filter((r) => r.id !== selectedTerritory).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => drillDown('rep', item.id)}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all flex items-center gap-2 opacity-60 hover:opacity-100 hover:bg-gray-50"
                      >
                        <span
                          className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-gray-700 truncate">{item.name}</div>
                          <div className="text-gray-400 truncate text-[10px]">{item.rep}</div>
                        </div>
                        <span className="text-gray-400 flex-shrink-0 tabular-nums">
                          {item.hospitalCount}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <div
            ref={mapRef}
            className="w-full rounded-lg overflow-hidden border border-gray-200"
            style={{ height: 520 }}
          />

          {/* Province badge overlay */}
          {selectedProvince && (
            <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg shadow-md px-3 py-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-gray-800">{selectedProvince}</span>
              {selectedLel && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs text-gray-600">{selectedLel}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
