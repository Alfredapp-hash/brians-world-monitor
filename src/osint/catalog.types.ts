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
}
