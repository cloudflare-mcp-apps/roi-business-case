import * as z from "zod/v4";

export const BuildBusinessCaseInput = {
  clientName: z.string()
    .min(1)
    .meta({ description: "Client company name, e.g. 'Fabryka Metali Sp. z o.o.'" }),
  industry: z.string()
    .optional()
    .meta({ description: "Client industry, e.g. 'Produkcja'" }),
  problems: z.array(z.object({
    name: z.string().meta({ description: "Problem name, e.g. 'Straty na reklamacjach'" }),
    annualCost: z.number().positive().meta({ description: "Annual cost of the problem in PLN" }),
    source: z.enum(["client", "estimate"]).meta({ description: "'client' = dane klienta (verified), 'estimate' = szacunek handlowca (~)" }),
    description: z.string().optional().meta({ description: "Problem description" }),
  })).min(1).max(5)
    .meta({ description: "Client problems with annual costs (1-5 items)" }),
  solution: z.object({
    name: z.string().meta({ description: "Solution name, e.g. 'System kontroli jakosci XYZ'" }),
    oneTimeCost: z.number().min(0).meta({ description: "One-time cost (implementation, setup, training) in PLN" }),
    annualCost: z.number().min(0).meta({ description: "Annual cost (license, service, maintenance) in PLN" }),
  }).meta({ description: "Solution pricing breakdown" }),
  effects: z.array(z.object({
    name: z.string().meta({ description: "Effect name, e.g. 'Redukcja reklamacji o 70%'" }),
    annualValue: z.number().positive().meta({ description: "Annual monetary value of the effect in PLN" }),
  })).min(1).max(5)
    .meta({ description: "Expected effects with annual values (1-5 items)" }),
  alternative: z.object({
    name: z.string().meta({ description: "Alternative name, e.g. 'Zatrudnienie 2 inspektorow'" }),
    annualCost: z.number().positive().meta({ description: "Annual cost of the alternative in PLN" }),
  }).optional()
    .meta({ description: "Optional comparison alternative (e.g. hiring people instead)" }),
};

export interface BuildBusinessCaseParams {
  clientName: string;
  industry?: string;
  problems: Array<{
    name: string;
    annualCost: number;
    source: "client" | "estimate";
    description?: string;
  }>;
  solution: {
    name: string;
    oneTimeCost: number;
    annualCost: number;
  };
  effects: Array<{
    name: string;
    annualValue: number;
  }>;
  alternative?: {
    name: string;
    annualCost: number;
  };
}
