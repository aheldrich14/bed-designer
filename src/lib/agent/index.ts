import { ClaudePlanner } from "./claude";
import { HeuristicPlanner } from "./heuristic";
import type { Planner } from "./planner";

export type { Planner } from "./planner";
export const heuristicPlanner = new HeuristicPlanner();

/** Claude when a key is configured, otherwise the offline heuristic. */
export function getPlanner(): Planner {
  if (process.env.PLANNER === "heuristic") return heuristicPlanner;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.PLANNER === "claude") {
    return new ClaudePlanner();
  }
  return heuristicPlanner;
}
