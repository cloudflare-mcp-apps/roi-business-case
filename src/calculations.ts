import type { BuildBusinessCaseParams } from "./schemas/inputs";

export interface BusinessCaseMetrics {
  totalProblemCost: number;
  totalEffectValue: number;
  solutionFirstYearCost: number;
  solutionOngoingCost: number;
  annualProfit: number;
  roiPercent: number;
  paybackMonths: number;
  costOfInaction12m: number;
}

export interface BusinessCaseResult {
  inputs: BuildBusinessCaseParams;
  metrics: BusinessCaseMetrics;
  businessCaseText: string;
  chartData: {
    problemBreakdown: Array<{ name: string; value: number; source: "client" | "estimate" }>;
    monthlyProjection: Array<{ month: number; cumulativeCost: number; cumulativeEffect: number }>;
    comparisonBar: {
      solution: number;
      alternative?: number;
      inaction: number;
    };
  };
}

export function calculateBusinessCase(params: BuildBusinessCaseParams): BusinessCaseResult {
  const totalProblemCost = params.problems.reduce((sum, p) => sum + p.annualCost, 0);
  const totalEffectValue = params.effects.reduce((sum, e) => sum + e.annualValue, 0);
  const solutionFirstYearCost = params.solution.oneTimeCost + params.solution.annualCost;
  const solutionOngoingCost = params.solution.annualCost;
  const annualProfit = totalEffectValue - params.solution.annualCost;
  const roiPercent = solutionFirstYearCost > 0
    ? (annualProfit / solutionFirstYearCost) * 100
    : 0;
  const paybackMonths = totalEffectValue > 0
    ? Math.ceil(solutionFirstYearCost / (totalEffectValue / 12))
    : Infinity;
  const costOfInaction12m = totalProblemCost;

  const monthlyProjection = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    cumulativeCost: params.solution.oneTimeCost + (params.solution.annualCost / 12 * (i + 1)),
    cumulativeEffect: totalEffectValue / 12 * (i + 1),
  }));

  const comparisonBar: BusinessCaseResult["chartData"]["comparisonBar"] = {
    solution: solutionOngoingCost,
    inaction: totalProblemCost,
  };
  if (params.alternative) {
    comparisonBar.alternative = params.alternative.annualCost;
  }

  const businessCaseText = generateBusinessCaseText(params, {
    totalProblemCost, totalEffectValue, solutionFirstYearCost,
    solutionOngoingCost, annualProfit, roiPercent, paybackMonths,
    costOfInaction12m,
  });

  return {
    inputs: params,
    metrics: {
      totalProblemCost, totalEffectValue, solutionFirstYearCost,
      solutionOngoingCost, annualProfit, roiPercent, paybackMonths,
      costOfInaction12m,
    },
    businessCaseText,
    chartData: {
      problemBreakdown: params.problems.map(p => ({
        name: p.name, value: p.annualCost, source: p.source,
      })),
      monthlyProjection,
      comparisonBar,
    },
  };
}

function formatPLN(value: number): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function generateBusinessCaseText(
  params: BuildBusinessCaseParams,
  metrics: BusinessCaseMetrics
): string {
  const problemLines = params.problems.map(p => {
    const tag = p.source === "client" ? "(dane klienta)" : "(szacunek)";
    return `  - ${p.name}: ${formatPLN(p.annualCost)} / rok ${tag}`;
  }).join('\n');

  const effectLines = params.effects.map(e =>
    `  - ${e.name}: ${formatPLN(e.annualValue)} / rok`
  ).join('\n');

  const alternativeLine = params.alternative
    ? `\nAlternatywa: ${params.alternative.name} — ${formatPLN(params.alternative.annualCost)} / rok`
    : '';

  const paybackStr = metrics.paybackMonths === Infinity
    ? 'brak zwrotu'
    : `${metrics.paybackMonths} mies.`;

  return `BUSINESS CASE — ${params.clientName}${params.industry ? ` (${params.industry})` : ''}

ZIDENTYFIKOWANE PROBLEMY:
${problemLines}
Laczny koszt problemow: ${formatPLN(metrics.totalProblemCost)} / rok

PROPONOWANE ROZWIAZANIE: ${params.solution.name}
  Koszt jednorazowy: ${formatPLN(params.solution.oneTimeCost)}
  Koszt roczny: ${formatPLN(metrics.solutionOngoingCost)}
  Koszt 1. roku: ${formatPLN(metrics.solutionFirstYearCost)}

OCZEKIWANE EFEKTY:
${effectLines}
Laczna wartosc efektow: ${formatPLN(metrics.totalEffectValue)} / rok

ANALIZA ROI:
  ROI: ${metrics.roiPercent.toFixed(0)}%
  Okres zwrotu: ${paybackStr}
  Zysk roczny: ${formatPLN(metrics.annualProfit)}
  Koszt braku zmiany (12 mies.): ${formatPLN(metrics.costOfInaction12m)}
${alternativeLine}`;
}
