export function validateArchiveTags(value: string): { tags: string[]; overlongIndices: number[]; tooMany: boolean } {
  const tags = value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
  return { tags, overlongIndices: tags.flatMap((tag, index) => [...tag].length > 32 ? [index] : []), tooMany: tags.length > 20 };
}
