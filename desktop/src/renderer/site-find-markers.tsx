import type { LayoutState } from '../shared/protocol';
import { SITE_FIND_MARKER_WIDTH, type SiteFindState } from '../shared/site-find';

/** 轨道位于外壳预留区，不覆盖 WebContentsView，也不向网站插入 UI。 */
export function SiteFindMarkers({ state, layout }: { state: SiteFindState; layout?: LayoutState }): React.JSX.Element | null {
  if (!state.open || !state.query || !layout) return null;
  return <div className="site-find-markers" aria-hidden="true">{layout.placements.map(placement => {
    const positions = state.sites.find(result => result.site === placement.key)?.positions;
    if (!positions?.length) return null;
    return <div className="site-find-marker-frame" key={placement.key} data-find-markers={placement.key}
      style={{ left: placement.bounds.x + placement.bounds.width - SITE_FIND_MARKER_WIDTH - 1,
        top: placement.bounds.y, width: SITE_FIND_MARKER_WIDTH, height: placement.bounds.height }}>
      <div className="site-find-marker-track">{positions.map((position, index) =>
        <i key={index} style={{ top: `${position * 100}%` }} />)}</div>
    </div>;
  })}</div>;
}
