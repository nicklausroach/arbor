export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function shortId(id: string): string {
  return id.replace(/^proj_/, "").replace(/-/g, "").slice(0, 8);
}
