// Designs land in Sagax (#2717). Claude Code's native Artifact tool tells the
// model to start any visual design with `quickstart` intent "design", which
// publishes to the person's claude.ai account, outside Sagax: no card in the
// chat, no versions, no Sagax design system. This PreToolUse hook answers
// that one call with a redirect to propose_page kind design. Every other
// Artifact call runs as before (#1990, #2018), and a person who names the
// claude.ai Design surface still gets it: the reason says how.

export const DESIGN_REDIRECT_REASON = "In Sagax a design is a Sagax page: call propose_page with kind design (screens as <section data-screen data-device>, design_system, design_tokens). It shows in this chat with versions, comments, sharing and export. Only when the person named the claude.ai Design surface, list the Artifact types (action list, scope types) and publish with the Design type_url instead.";

/** The hook script: reads the call on stdin, prints a deny for a design
 * quickstart, nothing otherwise. Single quotes only, so it rides in a
 * double-quoted `node -e` argument on every shell. */
export const DESIGN_REDIRECT_SCRIPT = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let i={};try{i=JSON.parse(d).tool_input||{}}catch{}"
  + "if(i.action==='quickstart'&&i.intent==='design')process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:"
  + `'${DESIGN_REDIRECT_REASON.replace(/'/g, "\\'")}'`
  + "}}))})";

/** The settings' hooks with the redirect added to PreToolUse. */
export function withDesignRedirectHook(hooks: unknown, execPath: string): Record<string, unknown> {
  const base = hooks && typeof hooks === "object" && !Array.isArray(hooks) ? hooks as Record<string, unknown> : {};
  const pre = Array.isArray(base.PreToolUse) ? base.PreToolUse : [];
  // the same quoting as claudeHookSettings: single quotes on POSIX, where
  // double quotes would still expand $ and backticks
  const node = process.platform === "win32" ? `"${execPath}"` : `'${execPath.replace(/'/g, "'\\''")}'`;
  const command = `${node} -e "${DESIGN_REDIRECT_SCRIPT}"`;
  return { ...base, PreToolUse: [...pre, { matcher: "Artifact", hooks: [{ type: "command", command, timeout: 10 }] }] };
}
