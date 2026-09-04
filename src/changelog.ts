export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | undefined;
  let section: ChangelogSection | undefined;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const releaseMatch = /^##\s+\[?([^\]\s]+)\]?\s+-\s+(.+)$/.exec(line);
    if (releaseMatch) {
      release = { version: releaseMatch[1], date: releaseMatch[2], sections: [] };
      releases.push(release);
      section = undefined;
      continue;
    }
    const sectionMatch = /^###\s+(.+)$/.exec(line);
    if (sectionMatch && release) {
      section = { title: sectionMatch[1], items: [] };
      release.sections.push(section);
      continue;
    }
    const itemMatch = /^-\s+(.+)$/.exec(line);
    if (itemMatch && section) section.items.push(itemMatch[1]);
  }

  return releases.filter((item) => item.sections.some((entry) => entry.items.length > 0));
}
