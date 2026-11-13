import { FliqError, type AgentQuoteRequest } from "../../../sdk/src/index.js";
import * as agent from "./agent.js";
import { toolsFor, type Mode, type ToolName } from "./definitions.js";
import * as developer from "./developer.js";
import { envelope, type Envelope } from "./envelope.js";
import { apiFailure } from "./shared.js";
import { validate } from "./validate.js";

export type ToolContext = developer.DeveloperContext | agent.AgentContext;

export function isToolName(name: string, mode: Mode): name is ToolName {
  return toolsFor(mode).some((tool) => tool.name === name);
}

export async function callTool(name: ToolName, args: unknown, context: ToolContext): Promise<Envelope> {
  const definition = toolsFor(context.mode).find((tool) => tool.name === name);
  const problem = definition ? validate(definition.inputSchema, args ?? {}) : `${name} is not a tool.`;
  if (problem) return envelope("invalid_input", problem, null);
  try {
    return await (context.mode === "agent"
      ? callAgentTool(name, args, context)
      : callDeveloperTool(name, args, context));
  } catch (error) {
    if (error instanceof FliqError) return apiFailure(error);
    return envelope("error", error instanceof Error ? error.message : "The tool failed.", null);
  }
}

function callDeveloperTool(name: ToolName, args: unknown, context: developer.DeveloperContext) {
  switch (name) {
    case "cashout_quote":
      return developer.quote(args as developer.QuoteArgs, context);
    case "cashout_verify_account":
      return developer.verify(args as developer.VerifyArgs, context);
    case "cashout_pay":
      return developer.pay(args as developer.PayArgs, context);
    case "cashout_status":
      return developer.status((args as { payout_id: string }).payout_id, context);
    default:
      throw new Error(`${name} is not a tool in developer mode.`);
  }
}

function callAgentTool(name: ToolName, args: unknown, context: agent.AgentContext) {
  switch (name) {
    case "cashout_limits":
      return agent.limits(context);
    case "cashout_recipients":
      return agent.recipients(context);
    case "cashout_quote":
      return agent.quote(args as AgentQuoteRequest, context);
    case "cashout_pay":
      return agent.pay(args as agent.AgentPayArgs, context);
    case "cashout_status":
      return agent.status((args as { payout_id: string }).payout_id, context);
    default:
      throw new Error(`${name} is not a tool in agent mode.`);
  }
}
