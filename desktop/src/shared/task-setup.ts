import type { SiteKey } from './contracts';
import type { Tier } from './protocol';
import type { PromptTemplate } from './prompt-library';
import type { ActiveWorkspaceGroup } from './workspace';
import { fillPromptVariables } from './prompt-variables';
import { PROMPT_TEMPLATE_TEXT_LIMIT } from './prompt-library';

export type TaskPreset = 'compare' | 'verify' | 'revise';
export interface TaskSetupPlan {
  readonly text: string;
  readonly sites: readonly SiteKey[];
  /** null keeps the existing mode; this is intent, never model observation. */
  readonly tier: Tier;
  readonly template?: PromptTemplate;
  readonly group?: ActiveWorkspaceGroup;
}
export function taskSetupPrompt(base: string, variables: Readonly<Record<string,string>>,
  dimensions: string, output: string, labels: {dimensions: string; output: string}, fillTemplate = true): string | null {
  const filled = fillTemplate ? fillPromptVariables(base, variables) : base;
  if (filled === null || !filled.trim()) return null;
  const text = [filled, dimensions.trim() ? `${labels.dimensions}\n${dimensions}` : '',
    output.trim() ? `${labels.output}\n${output}` : ''].filter(Boolean).join('\n\n');
  return [...text].length <= PROMPT_TEMPLATE_TEXT_LIMIT ? text : null;
}
export function sameTaskSites(left: readonly SiteKey[], right: readonly SiteKey[]): boolean {
  return left.length === right.length && left.every((site,index) => site === right[index]);
}
export function taskSetupSourcesCurrent(plan: TaskSetupPlan, templates: readonly PromptTemplate[], groups: readonly ActiveWorkspaceGroup[]): boolean {
  const template = plan.template, group = plan.group;
  return (!template || templates.some(item => item.id === template.id && item.updatedAt === template.updatedAt && item.text === template.text && item.name === template.name)) &&
    (!group || groups.some(item => item.id === group.id && item.updatedAt === group.updatedAt && sameTaskSites(item.sites, group.sites) && sameTaskSites(item.sites, plan.sites)));
}
