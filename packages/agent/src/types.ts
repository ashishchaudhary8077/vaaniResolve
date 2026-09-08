export type AgentKind = 'claude' | 'deterministic';

export interface ToolAction {
  tool: string | null;
  args: Record<string, unknown>;
}

export interface AgentDecision {
  kind: AgentKind;
  tool: string | null;
  args: Record<string, unknown>;
  intent: string;
  speech: string;
  needsConfirmation?: boolean;
  confirmSummary?: string;
  dueToError?: boolean;
  llmRaw?: string;
}