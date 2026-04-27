/**
 * MCP Server Factory — Cloudflare canonical pattern (createMcpHandler)
 *
 * Creates a fresh McpServer per request. The transport (WorkerTransport via
 * createMcpHandler) handles JSON-RPC dispatch natively — no custom protocol code.
 *
 * Auth context (userId, email) is populated by createMcpHandler from the
 * authContext option passed in src/index.ts; tools access it via getMcpAuthContext().
 */

import type { Env } from "./types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import * as z from "zod/v4";
import { BuildBusinessCaseInput, type BuildBusinessCaseParams } from "./schemas/inputs";
import { calculateBusinessCase } from "./calculations";
import { SERVER_CONFIG } from "./shared/constants";
import { UI_RESOURCES, UI_MIME_TYPE } from "./resources/ui-resources";
import { loadHtml } from "./helpers/assets";
import { SERVER_INSTRUCTIONS } from "./server-instructions";

// ============================================================================
// Tool execution — pure logic, independent of MCP framing
// ============================================================================

function executeBusinessCase(params: BuildBusinessCaseParams) {
  const result = calculateBusinessCase(params);

  const summaryText = `Business Case for ${params.clientName}: ROI ${result.metrics.roiPercent.toFixed(0)}%, payback ${result.metrics.paybackMonths === Infinity ? 'N/A' : result.metrics.paybackMonths + ' months'}. Total problem cost: ${result.metrics.totalProblemCost} PLN/yr, total effect: ${result.metrics.totalEffectValue} PLN/yr.`;

  return {
    content: [{ type: "text" as const, text: summaryText }],
    structuredContent: result as unknown as Record<string, unknown>,
    _meta: { viewUUID: crypto.randomUUID() },
  };
}

// ============================================================================
// Server factory — fresh McpServer per request (GHSA-345p-7cg4-v4c7 safe)
// ============================================================================

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: SERVER_CONFIG.NAME,
    version: SERVER_CONFIG.VERSION,
  }, {
    capabilities: { tools: {}, prompts: { listChanged: true }, resources: { listChanged: true } },
    instructions: SERVER_INSTRUCTIONS,
  });

  const widgetResource = UI_RESOURCES.widget;

  server.registerResource(
    widgetResource.name,
    widgetResource.uri,
    {
      mimeType: UI_MIME_TYPE,
      description: widgetResource.description,
    },
    async () => {
      const html = await loadHtml(env.ASSETS, "/widget.html");
      return {
        contents: [{
          uri: widgetResource.uri,
          mimeType: UI_MIME_TYPE,
          text: html,
          _meta: widgetResource._meta as Record<string, unknown>,
        }],
      };
    }
  );

  server.registerTool(
    "build_business_case",
    {
      title: "Build Business Case",
      description: "Builds an interactive ROI business case calculator from client problem costs, solution pricing, and expected effects. Returns structured financial data with real-time visualization including ROI percentage, payback period, cost comparison chart, and formatted business case text. Use when a salesperson needs to calculate ROI for a client, prepare a business case for a meeting, or visualize the cost of inaction vs. investment.",
      inputSchema: BuildBusinessCaseInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: widgetResource.uri }
      },
    },
    async (params) => {
      // Auth context is available via getMcpAuthContext() if needed for logging/scoping
      void getMcpAuthContext();
      return executeBusinessCase(params as BuildBusinessCaseParams);
    }
  );

  server.registerPrompt(
    "business-case",
    {
      title: "Business Case",
      description: "Zbuduj interaktywny business case z kalkulacja ROI na podstawie problemow klienta i kosztu rozwiazania. Podaj nazwe firmy i opisz problemy klienta z kosztami.",
      argsSchema: {
        context: z.string()
          .meta({ description: "Opis problemow klienta, kosztow i rozwiazania w dowolnej formie tekstowej" }),
      },
    },
    async ({ context }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Na podstawie ponizszego opisu zbuduj business case uzywajac narzedzia build_business_case. Wyodrebnij problemy klienta z kosztami rocznymi, parametry rozwiazania i oczekiwane efekty. Oznacz zrodlo danych: "client" jesli liczby podal klient, "estimate" jesli to szacunek handlowca.\n\n${context}`,
        },
      }],
    })
  );

  server.registerPrompt(
    "roi-quick",
    {
      title: "Quick ROI",
      description: "Szybka kalkulacja ROI: podaj roczny koszt problemu i cene rozwiazania.",
      argsSchema: {
        problemCost: z.coerce.number().positive()
          .meta({ description: "Roczny koszt problemu (PLN)" }),
        solutionCost: z.coerce.number().positive()
          .meta({ description: "Koszt rozwiazania (PLN)" }),
      },
    },
    async ({ problemCost, solutionCost }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Zbuduj szybki business case uzywajac build_business_case:\n- Problem: "Glowny problem" kosztuje ${problemCost} PLN rocznie (source: "estimate")\n- Rozwiazanie: koszt jednorazowy ${solutionCost} PLN, roczny 0 PLN\n- Efekt: "Eliminacja problemu" o wartosci ${problemCost} PLN rocznie\n- Klient: "Klient"`,
        },
      }],
    })
  );

  return server;
}
