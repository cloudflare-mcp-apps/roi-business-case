import type { Env } from "./types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { BuildBusinessCaseInput, type BuildBusinessCaseParams } from "./schemas/inputs";
import { calculateBusinessCase } from "./calculations";
import { CACHE_CONFIG, SERVER_CONFIG } from "./shared/constants";
import { UI_RESOURCES, UI_MIME_TYPE } from "./resources/ui-resources";
import { loadHtml } from "./helpers/assets";
import { SERVER_INSTRUCTIONS } from "./server-instructions";

// ============================================================================
// Validation Schema
// ============================================================================

const BuildBusinessCaseSchema = z.object(BuildBusinessCaseInput);

// ============================================================================
// Tool JSON Schemas (for tools/list response)
// ============================================================================

const TOOL_JSON_SCHEMAS = {
  build_business_case: {
    type: "object" as const,
    properties: {
      clientName: { type: "string" as const, description: "Client company name" },
      industry: { type: "string" as const, description: "Client industry" },
      problems: {
        type: "array" as const,
        description: "Client problems with annual costs (1-5 items)",
        items: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const, description: "Problem name" },
            annualCost: { type: "number" as const, description: "Annual cost in PLN" },
            source: { type: "string" as const, enum: ["client", "estimate"], description: "'client' = verified, 'estimate' = assumption" },
            description: { type: "string" as const, description: "Problem description" },
          },
          required: ["name", "annualCost", "source"],
        },
      },
      solution: {
        type: "object" as const,
        description: "Solution pricing breakdown",
        properties: {
          name: { type: "string" as const, description: "Solution name" },
          oneTimeCost: { type: "number" as const, description: "One-time cost in PLN" },
          annualCost: { type: "number" as const, description: "Annual cost in PLN" },
        },
        required: ["name", "oneTimeCost", "annualCost"],
      },
      effects: {
        type: "array" as const,
        description: "Expected effects with annual values (1-5 items)",
        items: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const, description: "Effect name" },
            annualValue: { type: "number" as const, description: "Annual value in PLN" },
          },
          required: ["name", "annualValue"],
        },
      },
      alternative: {
        type: "object" as const,
        description: "Optional comparison alternative",
        properties: {
          name: { type: "string" as const, description: "Alternative name" },
          annualCost: { type: "number" as const, description: "Annual cost in PLN" },
        },
        required: ["name", "annualCost"],
      },
    },
    required: ["clientName", "problems", "solution", "effects"],
  },
};

// ============================================================================
// Tool Execution
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

function validateAndExecuteTool(
  toolName: string,
  args: unknown,
): { result?: ReturnType<typeof executeBusinessCase>; error?: { code: number; message: string } } {
  if (toolName !== "build_business_case") {
    return { error: { code: -32602, message: `Unknown tool: ${toolName}` } };
  }

  const parsed = BuildBusinessCaseSchema.safeParse(args || {});
  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return { error: { code: -32602, message: `Invalid parameters: ${errorDetails}` } };
  }

  try {
    const result = executeBusinessCase(parsed.data);
    return { result };
  } catch (error) {
    return {
      error: { code: -32603, message: `Calculation error: ${error instanceof Error ? error.message : String(error)}` }
    };
  }
}

// ============================================================================
// LRU Cache
// ============================================================================

class LRUCache<K, V> {
  private cache: Map<K, { value: V; lastAccessed: number }>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.value;
    }
    return undefined;
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    this.cache.set(key, { value, lastAccessed: Date.now() });
  }

  private evictLRU(): void {
    let oldestKey: K | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
    }
  }
}

const serverCache = new LRUCache<string, McpServer>(CACHE_CONFIG.MAX_SERVERS);

// ============================================================================
// Public API
// ============================================================================

export function getOrCreateServer(
  env: Env,
  userId: string,
  _email: string
): McpServer {
  const cached = serverCache.get(userId);
  if (cached) return cached;

  const server = new McpServer({
    name: SERVER_CONFIG.NAME,
    version: SERVER_CONFIG.VERSION,
  }, {
    capabilities: { tools: {}, prompts: { listChanged: true }, resources: { listChanged: true } },
    instructions: SERVER_INSTRUCTIONS,
  });

  const widgetResource = UI_RESOURCES.widget;

  // Register UI Resource
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

  // Tool 1: build_business_case (model-visible)
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
    async (params) => executeBusinessCase(params as BuildBusinessCaseParams)
  );

  // Prompt 1: business-case
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

  // Prompt 2: roi-quick
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

  serverCache.set(userId, server);
  return server;
}

/**
 * Handle a JSON-RPC MCP request
 */
export async function handleMcpRequest(
  server: McpServer,
  request: Request,
  env: Env,
  userId: string,
  _userEmail: string
): Promise<Response> {
  try {
    const jsonRpcRequest = await request.json() as {
      jsonrpc: string;
      id: number | string;
      method: string;
      params?: any;
    };

    if (jsonRpcRequest.jsonrpc !== "2.0") {
      return jsonRpcResponse(jsonRpcRequest.id, null, { code: -32600, message: "Invalid Request" });
    }

    switch (jsonRpcRequest.method) {
      case "initialize":
        return handleInitialize(jsonRpcRequest);
      case "ping":
        return jsonRpcResponse(jsonRpcRequest.id, {});
      case "tools/list":
        return handleToolsList(jsonRpcRequest);
      case "tools/call":
        return handleToolsCall(jsonRpcRequest);
      case "resources/list":
        return handleResourcesList(jsonRpcRequest);
      case "resources/read":
        return handleResourcesRead(jsonRpcRequest, env);
      case "prompts/list":
        return handlePromptsList(jsonRpcRequest);
      case "prompts/get":
        return handlePromptsGet(jsonRpcRequest);
      default:
        return jsonRpcResponse(jsonRpcRequest.id, null, { code: -32601, message: `Method not found: ${jsonRpcRequest.method}` });
    }
  } catch (error) {
    return jsonRpcResponse("error", null, { code: -32700, message: `Parse error: ${error instanceof Error ? error.message : String(error)}` });
  }
}

// ============================================================================
// JSON-RPC Handlers
// ============================================================================

function handleInitialize(request: { id: number | string }): Response {
  return jsonRpcResponse(request.id, {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {}, prompts: { listChanged: true }, resources: { listChanged: true } },
    serverInfo: { name: SERVER_CONFIG.NAME, version: SERVER_CONFIG.VERSION },
  });
}

function handleToolsList(request: { id: number | string }): Response {
  const widgetResource = UI_RESOURCES.widget;
  return jsonRpcResponse(request.id, {
    tools: [
      {
        name: "build_business_case",
        title: "Build Business Case",
        description: "Builds an interactive ROI business case calculator from client problem costs, solution pricing, and expected effects. Returns structured financial data with real-time visualization including ROI percentage, payback period, cost comparison chart, and formatted business case text.",
        inputSchema: TOOL_JSON_SCHEMAS.build_business_case,
        _meta: {
          ui: { resourceUri: widgetResource.uri }
        },
      },
    ],
  });
}

function handleToolsCall(request: { id: number | string; params?: any }): Response {
  const { name, arguments: args } = request.params || {};
  const { result, error } = validateAndExecuteTool(name, args);
  if (error) return jsonRpcResponse(request.id, null, error);
  return jsonRpcResponse(request.id, result);
}

function handleResourcesList(request: { id: number | string }): Response {
  return jsonRpcResponse(request.id, {
    resources: [{
      uri: UI_RESOURCES.widget.uri,
      name: UI_RESOURCES.widget.name,
      description: UI_RESOURCES.widget.description,
      mimeType: UI_RESOURCES.widget.mimeType,
    }],
  });
}

async function handleResourcesRead(request: { id: number | string; params?: any }, env: Env): Promise<Response> {
  const { uri } = request.params || {};
  if (uri === UI_RESOURCES.widget.uri) {
    const html = await loadHtml(env.ASSETS, "/widget.html");
    return jsonRpcResponse(request.id, {
      contents: [{
        uri: UI_RESOURCES.widget.uri,
        mimeType: UI_MIME_TYPE,
        text: html,
        _meta: UI_RESOURCES.widget._meta,
      }],
    });
  }
  return jsonRpcResponse(request.id, null, { code: -32602, message: `Unknown resource: ${uri}` });
}

function handlePromptsList(request: { id: number | string }): Response {
  return jsonRpcResponse(request.id, {
    prompts: [
      {
        name: "business-case",
        title: "Business Case",
        description: "Zbuduj interaktywny business case z kalkulacja ROI na podstawie problemow klienta i kosztu rozwiazania.",
        arguments: [
          { name: "context", description: "Opis problemow klienta, kosztow i rozwiazania", required: true },
        ],
      },
      {
        name: "roi-quick",
        title: "Quick ROI",
        description: "Szybka kalkulacja ROI: podaj roczny koszt problemu i cene rozwiazania.",
        arguments: [
          { name: "problemCost", description: "Roczny koszt problemu (PLN)", required: true },
          { name: "solutionCost", description: "Koszt rozwiazania (PLN)", required: true },
        ],
      },
    ],
  });
}

async function handlePromptsGet(request: { id: number | string; params?: any }): Promise<Response> {
  const { name, arguments: args } = request.params || {};

  if (name === "business-case") {
    const context = args?.context || "";
    return jsonRpcResponse(request.id, {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Na podstawie ponizszego opisu zbuduj business case uzywajac narzedzia build_business_case. Wyodrebnij problemy klienta z kosztami rocznymi, parametry rozwiazania i oczekiwane efekty. Oznacz zrodlo danych: "client" jesli liczby podal klient, "estimate" jesli to szacunek handlowca.\n\n${context}`,
        },
      }],
    });
  }

  if (name === "roi-quick") {
    const problemCost = Number(args?.problemCost) || 100000;
    const solutionCost = Number(args?.solutionCost) || 50000;
    return jsonRpcResponse(request.id, {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Zbuduj szybki business case uzywajac build_business_case:\n- Problem: "Glowny problem" kosztuje ${problemCost} PLN rocznie (source: "estimate")\n- Rozwiazanie: koszt jednorazowy ${solutionCost} PLN, roczny 0 PLN\n- Efekt: "Eliminacja problemu" o wartosci ${problemCost} PLN rocznie\n- Klient: "Klient"`,
        },
      }],
    });
  }

  return jsonRpcResponse(request.id, null, { code: -32602, message: `Unknown prompt: ${name}` });
}

// ============================================================================
// Helpers
// ============================================================================

function jsonRpcResponse(id: number | string, result: any, error?: { code: number; message: string }): Response {
  const response: any = { jsonrpc: "2.0", id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json" },
  });
}
