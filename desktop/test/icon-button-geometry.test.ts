import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const requireCjs = createRequire(__filename);
const { findIconButtonIssues } = requireCjs(path.join(__dirname, "../scripts/lib/icon-button-geometry.cjs")) as {
  findIconButtonIssues: (
    items: readonly {
      readonly tag: string;
      readonly cls: string;
      readonly label: string;
      readonly btnW: number;
      readonly btnH: number;
      readonly svgW: number;
      readonly svgH: number;
      readonly dx: number;
      readonly dy: number;
      readonly segmented: boolean;
    }[],
    contextLabel: string
  ) => string[];
};

test("icon-button geometry gate passes centered square buttons and flags padding shift, SVG crushing, and bloat", () => {
  assert.deepEqual(
    findIconButtonIssues(
      [
        { tag: "button", cls: "question-icon-action", label: "复制原问题", btnW: 24, btnH: 24, svgW: 13, svgH: 13, dx: 0, dy: 0, segmented: false },
        { tag: "button", cls: "scope-menu", label: "选择已存分组", btnW: 27, btnH: 32, svgW: 14, svgH: 14, dx: 0, dy: 0, segmented: true }
      ],
      "history"
    ),
    []
  );

  const issues = findIconButtonIssues(
    [
      { tag: "button", cls: "question-icon-action", label: "复制原问题", btnW: 24, btnH: 23, svgW: 13, svgH: 13, dx: 2.5, dy: 0, segmented: false },
      { tag: "button", cls: "markdown-link-details", label: "查看完整链接", btnW: 22, btnH: 18, svgW: 11, svgH: 11, dx: -1.5, dy: 0, segmented: false },
      { tag: "button", cls: "library-menu-trigger", label: "更多操作", btnW: 26, btnH: 24, svgW: 8, svgH: 14, dx: 0, dy: 0, segmented: false },
      { tag: "button", cls: "library-menu-trigger", label: "更多操作", btnW: 34, btnH: 24, svgW: 14, svgH: 14, dx: 0, dy: 0, segmented: false }
    ],
    "regression"
  );
  assert.equal(issues.length, 4);
  assert.match(issues[0], /icon off-center dx=2\.5px/);
  assert.match(issues[1], /icon off-center dx=-1\.5px/);
  assert.match(issues[2], /icon SVG deformed 8x14/);
  assert.match(issues[3], /standalone icon button non-square 34x24/);
});
