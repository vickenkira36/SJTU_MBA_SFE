'use client';

import { useState, useCallback, useRef } from 'react';
import { Hospital, Territory, Constraint, OptimizationResult, AppStep, HistoricalAssignment, LockAssignment, RegionConstraintParams, AlgorithmMode } from '@/types';
import ExcelUpload from '@/components/ExcelUpload';
import ConstraintChat from '@/components/ConstraintChat';
import AlgoSelect from '@/components/AlgoSelect';
import OptimizingView from '@/components/OptimizingView';
import ResultsView from '@/components/ResultsView';
import { FileSpreadsheet, MessageSquare, BarChart3, Check } from 'lucide-react';

export default function Home() {
  const [step, setStep] = useState<AppStep>('upload');
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [historicalAssignments, setHistoricalAssignments] = useState<HistoricalAssignment[] | undefined>(undefined);
  const [lockAssignments, setLockAssignments] = useState<LockAssignment[] | undefined>(undefined);
  const [regionConstraints, setRegionConstraints] = useState<RegionConstraintParams[] | undefined>(undefined);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [optimizingProgress, setOptimizingProgress] = useState<{
    current: number;
    total: number;
    province: string;
  }>({ current: 0, total: 0, province: '' });
  const workerRef = useRef<Worker | null>(null);

  const handleDataLoaded = useCallback((h: Hospital[], t: Territory[], ha?: HistoricalAssignment[], la?: LockAssignment[]) => {
    setHospitals(h);
    setTerritories(t);
    setHistoricalAssignments(ha);
    setLockAssignments(la);
    setStep('constraints');
  }, []);

  const handleConstraintsReady = useCallback(
    (c: Constraint[], rc?: RegionConstraintParams[]) => {
      setConstraints(c);
      setRegionConstraints(rc);

      // If historical data exists, show algorithm selection; otherwise start directly
      if (historicalAssignments && historicalAssignments.length > 0) {
        setStep('algo-select');
      } else {
        startOptimization(c, rc, 'option1');
      }
    },
    [hospitals, territories, historicalAssignments, lockAssignments]
  );

  const startOptimization = useCallback(
    (c: Constraint[], rc: RegionConstraintParams[] | undefined, mode: AlgorithmMode) => {
      setStep('optimizing');

      const worker = new Worker(
        new URL('../lib/optimizer-worker.ts', import.meta.url)
      );
      workerRef.current = worker;

      worker.onmessage = (e) => {
        const { type, data } = e.data;
        if (type === 'progress') {
          setOptimizingProgress({
            current: data.current,
            total: data.total,
            province: data.province,
          });
        } else if (type === 'done') {
          setResult(data.result);
          setStep('results');
          worker.terminate();
          workerRef.current = null;
        }
      };

      worker.postMessage({
        hospitals,
        territories,
        constraints: c,
        historicalAssignments,
        lockAssignments,
        regionConstraints: rc,
        algorithmMode: mode,
      });
    },
    [hospitals, territories, historicalAssignments, lockAssignments]
  );

  const handleAlgoSelect = useCallback(
    (mode: AlgorithmMode) => {
      startOptimization(constraints, regionConstraints, mode);
    },
    [constraints, regionConstraints, startOptimization]
  );

  const handleBackToUpload = useCallback(() => setStep('upload'), []);
  const handleBackToConstraints = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setStep('constraints');
  }, []);

  const handleRestart = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setHospitals([]);
    setTerritories([]);
    setConstraints([]);
    setHistoricalAssignments(undefined);
    setLockAssignments(undefined);
    setRegionConstraints(undefined);
    setResult(null);
    setStep('upload');
  }, []);

  const steps = [
    { id: 'upload' as AppStep, label: '数据上传', icon: <FileSpreadsheet className="h-5 w-5" /> },
    { id: 'constraints' as AppStep, label: '约束条件', icon: <MessageSquare className="h-5 w-5" /> },
    { id: 'results' as AppStep, label: '分配结果', icon: <BarChart3 className="h-5 w-5" /> },
  ];

  const currentStepIndex = steps.findIndex((s) => {
    if (s.id === step) return true;
    if ((step === 'optimizing' || step === 'algo-select') && s.id === 'results') return true;
    return false;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/favicon.svg" alt="FFE" className="h-9 w-9 rounded-lg" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">FFE 辖区分配智能体</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  FFE Territory Alignment Agent
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {steps.map((s, i) => {
                const isActive = s.id === step || ((step === 'optimizing' || step === 'algo-select') && s.id === 'results');
                // Determine if this step has been reached based on available data
                const stepReachable =
                  s.id === 'upload' ||
                  (s.id === 'constraints' && hospitals.length > 0 && territories.length > 0) ||
                  (s.id === 'results' && result !== null);
                const isCompleted = stepReachable && !isActive;
                const canClick = stepReachable && !isActive && step !== 'optimizing' && step !== 'algo-select';
                const handleStepClick = () => {
                  if (!canClick) return;
                  if (workerRef.current) {
                    workerRef.current.terminate();
                    workerRef.current = null;
                  }
                  setStep(s.id);
                };
                // Determine connector color: filled if this step or earlier is reachable
                const connectorFilled = stepReachable || i <= currentStepIndex;
                return (
                  <div key={s.id} className="flex items-center">
                    {i > 0 && (
                      <div className={`w-8 h-0.5 mx-1 ${connectorFilled ? 'bg-blue-500' : 'bg-gray-200'}`} />
                    )}
                    <div
                      onClick={handleStepClick}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        isActive ? 'bg-blue-100 text-blue-700'
                          : isCompleted ? 'bg-green-50 text-green-600 cursor-pointer hover:bg-green-100'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {isCompleted ? <Check className="h-4 w-4" /> : s.icon}
                      <span className="hidden sm:inline">{s.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {step === 'upload' && (
          <ExcelUpload
            onDataLoaded={handleDataLoaded}
            initialHospitals={hospitals.length > 0 ? hospitals : undefined}
            initialTerritories={territories.length > 0 ? territories : undefined}
            initialHistorical={historicalAssignments}
            initialLockAssignments={lockAssignments}
          />
        )}

        {step === 'constraints' && (
          <ConstraintChat
            hospitals={hospitals}
            territories={territories}
            onConstraintsReady={handleConstraintsReady}
            onBack={handleBackToUpload}
            initialConstraints={constraints.length > 0 ? constraints : undefined}
            hasHistoricalData={!!historicalAssignments && historicalAssignments.length > 0}
            initialRegionConstraints={regionConstraints}
          />
        )}

        {step === 'algo-select' && (
          <AlgoSelect
            onSelect={handleAlgoSelect}
            onBack={handleBackToConstraints}
          />
        )}

        {step === 'optimizing' && (
          <OptimizingView
            progress={optimizingProgress}
            hospitalCount={hospitals.length}
            territoryCount={territories.length}
          />
        )}

        {step === 'results' && result && (
          <ResultsView
            result={result}
            hospitals={hospitals}
            territories={territories}
            constraints={constraints}
            onBack={handleBackToConstraints}
            onRestart={handleRestart}
          />
        )}
      </main>
    </div>
  );
}
