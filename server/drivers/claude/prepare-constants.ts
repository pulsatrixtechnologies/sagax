/** Shared prepare-time constants for the Claude driver (#1383). */
/** The tools of a searched agents catalog that only find a tool and run
 * nothing. call_tool and use_tool are never pre-allowed. */
export const COMPACT_DIRECTORY_TOOLS = ["search_tools", "describe_tool", "find_tool"] as const;
