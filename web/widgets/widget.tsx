import { StrictMode, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { App, PostMessageTransport, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import '../styles/globals.css';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler
);

// ============================================================================
// Types
// ============================================================================

interface ProblemInput {
  name: string;
  annualCost: number;
  source: "client" | "estimate";
  description?: string;
}

interface EffectInput {
  name: string;
  annualValue: number;
}

interface BusinessCaseInputs {
  clientName: string;
  industry?: string;
  problems: ProblemInput[];
  solution: { name: string; oneTimeCost: number; annualCost: number };
  effects: EffectInput[];
  alternative?: { name: string; annualCost: number };
}

interface BusinessCaseMetrics {
  totalProblemCost: number;
  totalEffectValue: number;
  solutionFirstYearCost: number;
  solutionOngoingCost: number;
  annualProfit: number;
  roiPercent: number;
  paybackMonths: number;
  costOfInaction12m: number;
}

interface BusinessCaseResult {
  inputs: BusinessCaseInputs;
  metrics: BusinessCaseMetrics;
  businessCaseText: string;
  chartData: {
    problemBreakdown: Array<{ name: string; value: number; source: "client" | "estimate" }>;
    monthlyProjection: Array<{ month: number; cumulativeCost: number; cumulativeEffect: number }>;
    comparisonBar: { solution: number; alternative?: number; inaction: number };
  };
}

type WidgetStatus = 'idle' | 'loading' | 'success' | 'error';

// ============================================================================
// Client-Side Calculation (mirrors server)
// ============================================================================

function calculateMetrics(inputs: BusinessCaseInputs): BusinessCaseMetrics {
  const totalProblemCost = inputs.problems.reduce((s, p) => s + p.annualCost, 0);
  const totalEffectValue = inputs.effects.reduce((s, e) => s + e.annualValue, 0);
  const solutionFirstYearCost = inputs.solution.oneTimeCost + inputs.solution.annualCost;
  const solutionOngoingCost = inputs.solution.annualCost;
  const annualProfit = totalEffectValue - inputs.solution.annualCost;
  const roiPercent = solutionFirstYearCost > 0 ? (annualProfit / solutionFirstYearCost) * 100 : 0;
  const paybackMonths = totalEffectValue > 0 ? Math.ceil(solutionFirstYearCost / (totalEffectValue / 12)) : Infinity;
  return {
    totalProblemCost,
    totalEffectValue,
    solutionFirstYearCost,
    solutionOngoingCost,
    annualProfit,
    roiPercent,
    paybackMonths,
    costOfInaction12m: totalProblemCost,
  };
}

// ============================================================================
// Formatters
// ============================================================================

function formatPLN(value: number): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency', currency: 'PLN', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function formatPLNShort(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

// ============================================================================
// Sub-Components
// ============================================================================

function SliderInput({
  label, value, min, max, step, badge, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  badge?: { text: string; color: string }; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
          {badge && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.color}`}>
              {badge.text}
            </span>
          )}
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
          {formatPLN(value)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>{formatPLNShort(min)}</span>
        <span>{formatPLNShort(max)}</span>
      </div>
    </div>
  );
}

function MetricCard({
  label, value, colorClass,
}: {
  label: string; value: string; colorClass: string;
}) {
  return (
    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold ${colorClass}`}>{value}</div>
    </div>
  );
}

function roiColor(roi: number): string {
  if (roi > 100) return 'text-green-600 dark:text-green-400';
  if (roi >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function paybackColor(months: number): string {
  if (months <= 6) return 'text-green-600 dark:text-green-400';
  if (months <= 12) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

// ============================================================================
// Main Widget
// ============================================================================

function Widget() {
  const [app, setApp] = useState<App | null>(null);
  const [appError, setAppError] = useState<Error | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext>();
  const [status, setStatus] = useState<WidgetStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [viewUUID, setViewUUID] = useState<string | null>(null);
  const [liveInputs, setLiveInputs] = useState<BusinessCaseInputs | null>(null);

  const viewUUIDRef = useRef<string | null>(null);
  const liveInputsRef = useRef<BusinessCaseInputs | null>(null);

  useEffect(() => { viewUUIDRef.current = viewUUID; }, [viewUUID]);
  useEffect(() => { liveInputsRef.current = liveInputs; }, [liveInputs]);

  const liveMetrics = useMemo(() => liveInputs ? calculateMetrics(liveInputs) : null, [liveInputs]);

  const updateProblemCost = useCallback((idx: number, value: number) => {
    setLiveInputs(prev => {
      if (!prev) return prev;
      const problems = [...prev.problems];
      problems[idx] = { ...problems[idx], annualCost: value };
      return { ...prev, problems };
    });
  }, []);

  const updateEffectValue = useCallback((idx: number, value: number) => {
    setLiveInputs(prev => {
      if (!prev) return prev;
      const effects = [...prev.effects];
      effects[idx] = { ...effects[idx], annualValue: value };
      return { ...prev, effects };
    });
  }, []);

  const updateSolution = useCallback((field: 'oneTimeCost' | 'annualCost', value: number) => {
    setLiveInputs(prev => {
      if (!prev) return prev;
      return { ...prev, solution: { ...prev.solution, [field]: value } };
    });
  }, []);

  // App initialization
  useEffect(() => {
    const appInstance = new App(
      { name: "roi-business-case", version: "1.0.0" },
      {},
      { autoResize: false }
    );

    appInstance.ontoolinput = () => {
      setStatus('loading');
    };

    appInstance.ontoolresult = (result) => {
      try {
        const uuid = (result as any)?._meta?.viewUUID as string | undefined;
        if (uuid) {
          setViewUUID(uuid);
          const saved = localStorage.getItem(`roi-bc-${uuid}`);
          if (saved) {
            try {
              const parsed = JSON.parse(saved) as { inputs?: BusinessCaseInputs };
              if (parsed.inputs) {
                setLiveInputs(parsed.inputs);
                setStatus('success');
                return;
              }
            } catch { /* use server data */ }
          }
        }

        let data: BusinessCaseResult | null = null;
        if (result.structuredContent) {
          data = result.structuredContent as unknown as BusinessCaseResult;
        } else if (result.content && result.content.length > 0) {
          const text = result.content.find((c: any) => c.type === 'text');
          if (text && 'text' in text) data = JSON.parse((text as any).text);
        }

        if (data?.inputs) {
          setLiveInputs(data.inputs);
          setStatus('success');
        }
      } catch (e) {
        setStatus('error');
        setErrorMsg('Failed to parse result');
      }
    };

    appInstance.onerror = (error) => {
      setAppError(error instanceof Error ? error : new Error(String(error)));
      setStatus('error');
      setErrorMsg(String(error));
    };

    appInstance.onhostcontextchanged = (context) => {
      setHostContext(prev => ({ ...prev, ...context }));
      if (context.theme) {
        applyDocumentTheme(context.theme);
        document.documentElement.classList.toggle('dark', context.theme === 'dark');
      }
    };

    appInstance.onteardown = async () => {
      const uuid = viewUUIDRef.current;
      const inputs = liveInputsRef.current;
      if (uuid && inputs) {
        try {
          localStorage.setItem(`roi-bc-${uuid}`, JSON.stringify({ inputs, timestamp: Date.now() }));
        } catch { /* non-critical */ }
      }
      return {};
    };

    const transport = new PostMessageTransport(window.parent, window.parent);
    appInstance.connect(transport)
      .then(() => {
        setApp(appInstance);
        setHostContext(appInstance.getHostContext());
        appInstance.sendSizeChanged({ height: 600 });
      })
      .catch((err) => {
        setAppError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => { appInstance.close(); };
  }, []);

  // Safe area
  const safeStyle: React.CSSProperties = hostContext?.safeAreaInsets ? {
    paddingTop: hostContext.safeAreaInsets.top,
    paddingRight: hostContext.safeAreaInsets.right,
    paddingBottom: hostContext.safeAreaInsets.bottom,
    paddingLeft: hostContext.safeAreaInsets.left,
  } : {};

  // --- States ---

  if (appError && status !== 'error') {
    return (
      <div className="h-[600px] flex items-center justify-center bg-white dark:bg-slate-900" style={safeStyle}>
        <div className="text-center p-6">
          <p className="text-red-500 font-medium">Connection Error</p>
          <p className="text-red-400 text-sm mt-1">{appError.message}</p>
        </div>
      </div>
    );
  }

  if (!app && !appError) {
    return (
      <div className="h-[600px] flex items-center justify-center bg-white dark:bg-slate-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (status === 'idle') {
    return (
      <div className="h-[600px] flex items-center justify-center bg-white dark:bg-slate-900" style={safeStyle}>
        <div className="text-center p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">ROI Business Case Builder</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">Waiting for tool input...</p>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="h-[600px] flex items-center justify-center bg-white dark:bg-slate-900" style={safeStyle}>
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          <span className="text-gray-600 dark:text-gray-300">Calculating...</span>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="h-[600px] flex items-center justify-center bg-white dark:bg-slate-900" style={safeStyle}>
        <div className="text-center p-6">
          <p className="text-red-500 font-medium">Error</p>
          <p className="text-red-400 text-sm mt-1">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (!liveInputs || !liveMetrics) return null;

  // --- Success State ---

  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const textColor = isDark ? '#f3f4f6' : '#374151';

  // Monthly projection data
  const projectionData = {
    labels: Array.from({ length: 12 }, (_, i) => `${i + 1}`),
    datasets: [
      {
        label: 'Skumulowany koszt',
        data: Array.from({ length: 12 }, (_, i) =>
          liveInputs.solution.oneTimeCost + (liveInputs.solution.annualCost / 12 * (i + 1))
        ),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.1)',
        fill: true,
        tension: 0.3,
      },
      {
        label: 'Skumulowany efekt',
        data: Array.from({ length: 12 }, (_, i) =>
          liveMetrics.totalEffectValue / 12 * (i + 1)
        ),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.1)',
        fill: true,
        tension: 0.3,
      },
    ],
  };

  // Comparison bar data
  const compLabels = ['Rozwiazanie (roczne)'];
  const compValues = [liveMetrics.solutionOngoingCost];
  const compColors = ['#3b82f6'];
  if (liveInputs.alternative) {
    compLabels.push(liveInputs.alternative.name);
    compValues.push(liveInputs.alternative.annualCost);
    compColors.push('#f59e0b');
  }
  compLabels.push('Koszt braku zmiany');
  compValues.push(liveMetrics.costOfInaction12m);
  compColors.push('#ef4444');

  const comparisonData = {
    labels: compLabels,
    datasets: [{
      data: compValues,
      backgroundColor: compColors,
      borderRadius: 4,
    }],
  };

  const paybackStr = liveMetrics.paybackMonths === Infinity ? 'N/A' : `${liveMetrics.paybackMonths} mies.`;

  return (
    <div className="h-[600px] w-full flex flex-col bg-white dark:bg-slate-900 overflow-hidden" style={safeStyle}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">

          {/* Header */}
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              BUSINESS CASE &mdash; {liveInputs.clientName}
            </h1>
            {liveInputs.industry && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                {liveInputs.industry}
              </span>
            )}
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="ROI"
              value={`${liveMetrics.roiPercent.toFixed(0)}%`}
              colorClass={roiColor(liveMetrics.roiPercent)}
            />
            <MetricCard
              label="Okres zwrotu"
              value={paybackStr}
              colorClass={paybackColor(liveMetrics.paybackMonths)}
            />
            <MetricCard
              label="Koszt braku zmiany"
              value={formatPLN(liveMetrics.costOfInaction12m) + '/rok'}
              colorClass="text-red-600 dark:text-red-400"
            />
          </div>

          {/* Problem Sliders */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              Koszt problemow
            </h3>
            {liveInputs.problems.map((p, i) => (
              <SliderInput
                key={i}
                label={p.name}
                value={p.annualCost}
                min={0}
                max={Math.max(p.annualCost * 3, 100000)}
                step={Math.max(Math.round(p.annualCost / 100) * 5, 1000)}
                badge={p.source === 'client'
                  ? { text: '\u2713 dane klienta', color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' }
                  : { text: '~ szacunek', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300' }
                }
                onChange={(v) => updateProblemCost(i, v)}
              />
            ))}
            <div className="text-right text-sm font-medium text-gray-600 dark:text-gray-400">
              Lacznie: {formatPLN(liveMetrics.totalProblemCost)} / rok
            </div>
          </div>

          {/* Solution Sliders */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              Koszt rozwiazania: {liveInputs.solution.name}
            </h3>
            <SliderInput
              label="Koszt jednorazowy"
              value={liveInputs.solution.oneTimeCost}
              min={0}
              max={Math.max(liveInputs.solution.oneTimeCost * 3, 100000)}
              step={Math.max(Math.round(liveInputs.solution.oneTimeCost / 100) * 5, 1000)}
              onChange={(v) => updateSolution('oneTimeCost', v)}
            />
            <SliderInput
              label="Koszt roczny"
              value={liveInputs.solution.annualCost}
              min={0}
              max={Math.max(liveInputs.solution.annualCost * 3, 100000)}
              step={Math.max(Math.round(liveInputs.solution.annualCost / 100) * 5, 1000)}
              onChange={(v) => updateSolution('annualCost', v)}
            />
          </div>

          {/* Effect Sliders */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              Oczekiwane efekty
            </h3>
            {liveInputs.effects.map((e, i) => (
              <SliderInput
                key={i}
                label={e.name}
                value={e.annualValue}
                min={0}
                max={Math.max(e.annualValue * 3, 100000)}
                step={Math.max(Math.round(e.annualValue / 100) * 5, 1000)}
                onChange={(v) => updateEffectValue(i, v)}
              />
            ))}
            <div className="text-right text-sm font-medium text-gray-600 dark:text-gray-400">
              Lacznie: {formatPLN(liveMetrics.totalEffectValue)} / rok
            </div>
          </div>

          {/* Projection Chart */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
              Projekcja 12-miesiezna
            </h3>
            <div className="h-48">
              <Line
                data={projectionData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  plugins: {
                    legend: { position: 'top', labels: { color: textColor, boxWidth: 12, padding: 8, font: { size: 11 } } },
                    tooltip: {
                      callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatPLN(ctx.parsed.y)}` },
                    },
                  },
                  scales: {
                    x: { title: { display: true, text: 'Miesiac', color: textColor, font: { size: 11 } }, ticks: { color: textColor }, grid: { color: gridColor } },
                    y: { title: { display: true, text: 'PLN', color: textColor, font: { size: 11 } }, ticks: { color: textColor, callback: (v) => formatPLNShort(v as number) }, grid: { color: gridColor } },
                  },
                }}
              />
            </div>
          </div>

          {/* Comparison Chart */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
              Porownanie roczne
            </h3>
            <div className="h-32">
              <Bar
                data={comparisonData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: 'y',
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: { label: (ctx) => formatPLN(ctx.parsed.x) },
                    },
                  },
                  scales: {
                    x: { ticks: { color: textColor, callback: (v) => formatPLNShort(v as number) }, grid: { color: gridColor } },
                    y: { ticks: { color: textColor, font: { size: 11 } }, grid: { display: false } },
                  },
                }}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// Mount
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Widget />
    </StrictMode>
  );
}
