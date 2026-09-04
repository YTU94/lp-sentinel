import { describe, expect, it } from 'vitest';
import { parseChangelog } from '../src/changelog';

describe('parseChangelog', () => {
  it('parses releases, dates, sections and list items in display order', () => {
    const releases = parseChangelog(`# 更新日志

## [0.2.0] - 2026-09-04
### 新增
- 显示版本信息。
- 支持更新日志。

## [0.1.0] - 2026-09-01
### 修复
- 修复旧问题。
`);

    expect(releases).toEqual([
      { version: '0.2.0', date: '2026-09-04', sections: [{ title: '新增', items: ['显示版本信息。', '支持更新日志。'] }] },
      { version: '0.1.0', date: '2026-09-01', sections: [{ title: '修复', items: ['修复旧问题。'] }] },
    ]);
  });

  it('ignores headings and bullets outside a release', () => {
    expect(parseChangelog('# 标题\n### 新增\n- 无版本条目')).toEqual([]);
  });
});
