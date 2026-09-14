/** Portable OSINT4ALL catalog — generated from ToolDatabase.swift */

export type OsintTag =
  | "web"
  | "cli"
  | "python"
  | "free"
  | "freemium"
  | "paid"
  | "api"
  | "tor"
  | "browser";

export interface OsintCategory {
  id: string;
  label: string;
  /** SF Symbol name from the macOS app; web clients can map this to an icon. */
  icon: string;
  description: string;
  toolIds: string[];
}

export interface OsintTool {
  id: string;
  name: string;
  url: string;
  hostname: string;
  summary: string;
  detail: string;
  howTo: string[];
  proTip: string | null;
  alternatives: string[];
  tags: OsintTag[];
  installCommand: string | null;
  categoryIds: string[];
  agentTool: string;
}

/** Optional lazy-expand overlay from catalog.details-{0,1,2}.json */
export interface OsintToolDetails {
  detail?: string;
  howTo?: string[];
  proTip?: string | null;
  alternatives?: string[];
}

export type OsintDetailsShard = Record<string, OsintToolDetails>;

export interface OsintCatalog {
  source: "osint4all-native";
  sourceFiles: string[];
  generatedAt: string;
  version: 2;
  toolCount: number;
  categoryCount: number;
  tags: OsintTag[];
  searchHints: string[];
  synonyms: string[][];
  categories: OsintCategory[];
  tools: OsintTool[];
  /** Basenames under /osint/ — each file is a JSON array of tools. */
  toolShardFiles?: string[];
}
