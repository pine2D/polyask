import { PROMPT_TEMPLATE_TEXT_LIMIT } from "./prompt-library";

const VARIABLE = /\{\{([^{}\r\n]{1,40})\}\}/g;

export function promptVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map(match => match[1].trim()).filter(Boolean))];
}

// 单次替换：变量值中的花括号、美元符号和换行都是原文，不再解析。
export function fillPromptVariables(text: string, values: Readonly<Record<string, string>>): string | null {
  if (promptVariables(text).some(name => !Object.hasOwn(values, name) || !values[name].trim())) return null;
  const filled = text.replace(VARIABLE, (token, name: string) => name.trim() ? values[name.trim()] : token);
  return [...filled].length <= PROMPT_TEMPLATE_TEXT_LIMIT ? filled : null;
}
