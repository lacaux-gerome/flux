import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { ActionKind } from "../shared/types";
import type { StoresConfig } from "./sources/stores";

const HOME = homedir();

// One product you alternate on: its Jira projects and its GitHub repos
export interface Workspace {
  id: string;
  label: string;
  // Short name shown in the switch (WEB, APP…); defaults to the label
  short?: string;
  // Jira project keys whose tickets belong to this workspace
  jiraProjects: string[];
  // Linear team keys whose tickets belong to this workspace
  linearTeams?: string[];
  github: {
    // Organisation the repos live in; falls back to github.owner
    owner?: string;
    // Repo names (or owner/name); empty means every repo of the owner
    repos?: string[];
    // Repos where your PRs merge without a review: an open PR is yours to ship, not waiting on anyone
    noReview?: string[];
  };
}

// Everything specific to one person or one company lives in config.json, never in the repo:
// ~/.flux/config.json
export interface FluxConfig {
  // Name the triage prompt uses for the person Flux works for
  ownerName: string;
  github: {
    host: string;
    // Organisation or user that owns the repos; empty means every repo you are involved in
    owner: string;
    // Logins whose review comments never count as a human waiting on you
    bots: string[];
  };
  linear: {
    // Team keys recognised in PR titles and branch names (OFF, WEB…); empty means any UPPER-123 key
    teams: string[];
  };
  jira: {
    // Atlassian site, e.g. https://acme.atlassian.net
    site: string;
  };
  // Products you switch between; empty means a single view of everything
  workspaces: Workspace[];
  paths: {
    // Notes vault holding topics (flux/) and daily notes (daily/)
    vault: string;
    // Folder holding the git clones threads open in
    repos: string;
    // Prompt file the daily runs
    dailyCommand: string;
  };
  daily: {
    // Read-only MCP tools the daily may call, and servers it must not load
    allowedTools: string[];
    disallowedTools: string[];
    // Apps whose new store reviews the daily shows, read by Flux itself
    stores: StoresConfig;
  };
  // Prompt per action, with {url} and {ref} placeholders; overrides the built-in wording
  prompts: Partial<Record<ActionKind, string>>;
}

export const DEFAULT_CONFIG: FluxConfig = {
  ownerName: "la personne qui utilise Flux",
  github: { host: "github.com", owner: "", bots: [] },
  linear: { teams: [] },
  jira: { site: "" },
  workspaces: [],
  paths: {
    vault: join(HOME, "Documents/Flux"),
    repos: join(HOME, "code"),
    dailyCommand: join(HOME, ".claude/commands/daily.md"),
  },
  daily: { allowedTools: [], disallowedTools: [], stores: { country: "us", language: "en", apps: [] } },
  prompts: {},
};

type Overrides = {
  [Key in keyof FluxConfig]?: FluxConfig[Key] extends unknown[] | string
    ? FluxConfig[Key]
    : Partial<FluxConfig[Key]>;
};

function expand(path: string): string {
  if (path.startsWith("~/")) return join(HOME, path.slice(2));
  return isAbsolute(path) ? path : join(HOME, path);
}

export function mergeConfig(overrides: Overrides): FluxConfig {
  const paths = { ...DEFAULT_CONFIG.paths, ...overrides.paths };
  return {
    ownerName: overrides.ownerName ?? DEFAULT_CONFIG.ownerName,
    github: { ...DEFAULT_CONFIG.github, ...overrides.github },
    linear: { ...DEFAULT_CONFIG.linear, ...overrides.linear },
    jira: { site: (overrides.jira?.site ?? "").replace(/\/+$/, "") },
    workspaces: (overrides.workspaces ?? []).map(workspace => ({
      ...workspace,
      jiraProjects: (workspace.jiraProjects ?? []).map(key => key.toUpperCase()),
      github: { ...workspace.github },
    })),
    paths: {
      vault: expand(paths.vault),
      repos: expand(paths.repos),
      dailyCommand: expand(paths.dailyCommand),
    },
    daily: {
      ...DEFAULT_CONFIG.daily,
      ...overrides.daily,
      stores: { ...DEFAULT_CONFIG.daily.stores, ...overrides.daily?.stores },
    },
    prompts: { ...overrides.prompts },
  };
}

export const CONFIG_FILE = process.env.FLUX_CONFIG
  ? expand(process.env.FLUX_CONFIG)
  : join(HOME, ".flux", "config.json");

function loadConfig(path: string): FluxConfig {
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    return mergeConfig(JSON.parse(readFileSync(path, "utf8")) as Overrides);
  } catch (error) {
    console.error(`Configuration illisible (${path}) : ${(error as Error).message}`);
    return DEFAULT_CONFIG;
  }
}

export const CONFIG = loadConfig(CONFIG_FILE);
