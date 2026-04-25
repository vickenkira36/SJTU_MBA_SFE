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
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
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
      // Always store compound key for split hospitals
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

  // Full bounds for "all" view
  const fullBounds = useMemo(() => {
    if (validHospitals.length === 0) return null;
    return L.latLngBounds(
      validHospitals.map((h) => [h.latitude, h.longitude] as [number, number])
    );
  }, [validHospitals]);

  // Territory legend filtered by selected province
  const legendData = useMemo(() => {
    const filtered = selectedProvince
      ? result.territoryResults.filter((tr) => tr.territory.province === selectedProvince)
      : result.territoryResults;

    return filtered.map((tr) => {
      const tIdx = territories.findIndex((t) => t.id === tr.territory.id);
      return {
        id: tr.territory.id,
        name: tr.territory.trtyCode,
        rep: tr.territory.rep,
        lel: tr.territory.lel || '',
        color: COLORS[(tIdx >= 0 ? tIdx : 0) % COLORS.length],
        hospitalCount: tr.hospitalCount,
        index: tr.totalIndex,
      };
    }).sort((a, b) => b.index - a.index);
  }, [result, territories, selectedProvince]);

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

  // Render markers based on province/territory selection
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

      const isHighlighted = !selectedTerritory || info.territoryId === selectedTerritory;
      const color = COLORS[info.colorIndex % COLORS.length];

      // Larger markers when drilled into a province
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
  }, [validHospitals, hospitalTerritoryMap, selectedProvince, selectedTerritory]);

  // Zoom to province or back to full view
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

  const handleProvinceClick = useCallback((name: string) => {
    setSelectedTerritory(null);
    setSelectedProvince((prev) => (prev === name ? null : name));
  }, []);

  const handleBackToAll = useCallback(() => {
    setSelectedProvince(null);
    setSelectedTerritory(null);
  }, []);

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
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">
          辖区地图分布
          {selectedProvince && (
            <span className="ml-2 text-blue-600 font-bold">— {selectedProvince}</span>
          )}
        </h3>
        {selectedProvince && (
          <button
            onClick={handleBackToAll}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回全国视图
          </button>
        )}
      </div>

      <div className="flex gap-4">
        {/* Sidebar */}
        <div className={`flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-8' : 'w-56'}`}>
          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center py-1 mb-2 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-50"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          {!sidebarCollapsed && (
            <>
              {/* Province list — shown when no province is selected */}
              {!selectedProvince && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 font-medium">
                    省份（点击下钻）
                  </div>
                  <div className="max-h-[460px] overflow-y-auto space-y-0.5 pr-1">
                    {provinceData.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => handleProvinceClick(p.name)}
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

              {/* Territory legend — shown when drilled into a province */}
              {selectedProvince && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 font-medium">
                    辖区（点击筛选）
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

                    {legendData.map((item) => (
                      <button
                        key={item.id}
                        onClick={() =>
                          setSelectedTerritory(
                            selectedTerritory === item.id ? null : item.id
                          )
                        }
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
                          {(item.rep || item.lel) && (
                            <div className="text-gray-400 truncate text-[10px]">
                              {item.rep}{item.rep && item.lel ? ' · ' : ''}{item.lel && `LEL: ${item.lel}`}
                            </div>
                          )}
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

          {/* Province badge overlay on map */}
          {selectedProvince && (
            <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg shadow-md px-3 py-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-gray-800">{selectedProvince}</span>
              <span className="text-xs text-gray-500">
                {provinceData.find((p) => p.name === selectedProvince)?.hospitalCount || 0} 家医院
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
