export function parsePrUrl(output: string, owner: string, repo: string): { number: number; url: string } | undefined {
  const re = new RegExp(`https://github\\.com/${owner}/${repo}/pull/(\\d+)`, "g");
  let match: RegExpExecArray | null;
  let last: { number: number; url: string } | undefined;
  while ((match = re.exec(output))) {
    last = { number: Number(match[1]), url: match[0] };
  }
  return last;
}
