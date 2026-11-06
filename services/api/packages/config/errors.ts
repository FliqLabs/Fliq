export type ConfigIssue = { variable: string; problem: string };

// Issues name the variable and the rule it broke, never its value: most values here are secrets.
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const lines = issues.map((issue) => `  ${issue.variable}: ${issue.problem}`);
    super(`configuration refused, ${issues.length} problem(s):\n${lines.join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}
