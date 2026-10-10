import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { resolveLocale } from '../shared/locale';
import { FOLDER_PAGE_SIZE, type FolderContentPage, type FolderContentSummary, type FolderPageRequest } from '../shared/task-folder-page';
import { readJson } from './repository-utils';

const key = (kind: unknown, id: unknown) => `${kind}:${id}`;
const title = `CASE WHEN kind = 'archive' THEN
  coalesce(nullif(json_extract(body, '$.task'), ''), json_extract(body, '$.preview'))
  ELSE json_extract(body, '$.title') END`;
const summary = `CASE WHEN kind = 'archive' THEN json_object('kind', kind, 'record',
  json_object('id', id, 'task', substr(json_extract(body, '$.task'), 1, 512),
    'preview', substr(json_extract(body, '$.preview'), 1, 320), 'ts', json_extract(body, '$.ts'),
    'createdAt', created_at, 'updatedAt', updated_at,
    'favorite', json(CASE WHEN json_extract(body, '$.favorite') THEN 'true' ELSE 'false' END),
    'tags', json_extract(body, '$.tags'), 'results', json((SELECT json_group_array(
      json_object('label', json_extract(value, '$.label'))) FROM json_each(body, '$.results')))))
  ELSE json_object('kind', kind, 'record', json_object('id', id,
    'title', json_extract(body, '$.title'), 'status', json_extract(body, '$.status'),
    'createdAt', created_at, 'updatedAt', updated_at)) END AS body`;

export class TaskFolderQuery {
  constructor(private readonly database: DatabaseSync) {
    // SQLite lower() only handles ASCII; keep the existing JS Unicode search semantics.
    database.function('polyask_library_lower', { deterministic: true }, value => String(value ?? '').toLocaleLowerCase());
  }
  query(request: FolderPageRequest): FolderContentPage {
    const params: SQLInputValue[] = [];
    const bind = (value: SQLInputValue) => { params.push(value); return '?'; };
    const query = request.query?.trim().toLocaleLowerCase() ?? '';
    const sources = [];
    if (request.kind !== 'decision') sources.push(`SELECT 'archive' AS kind, id, body FROM archives
      WHERE deleted_at IS NULL AND json_valid(body)
      ${query ? `AND instr(json_extract(body, '$.searchText'), ${bind(request.query!.trim().toLowerCase())}) > 0` : ''}
      ${request.favorite ? `AND json_extract(body, '$.favorite') = 1` : ''}
      ${request.tag?.trim() ? `AND EXISTS (SELECT 1 FROM json_each(body, '$.tags') WHERE value = ${bind(request.tag.trim())})` : ''}`);
    if (request.kind !== 'archive') sources.push(`SELECT 'decision' AS kind, id, body FROM decisions
      WHERE deleted_at IS NULL AND json_valid(body)
      ${request.status ? `AND json_extract(body, '$.status') = ${bind(request.status)}` : ''}
      ${query ? `AND instr(polyask_library_lower(json_extract(body, '$.title') || char(10) ||
        json_extract(body, '$.conclusion') || char(10) || json_extract(body, '$.rationale') || char(10) ||
        json_extract(body, '$.uncertainties') || char(10) || json_extract(body, '$.nextStep') || char(10) ||
        json_extract(body, '$.sourceTitle') || coalesce((SELECT char(10) || group_concat(json_extract(value, '$.excerpt'), char(10))
          FROM json_each(body, '$.evidence')), '')), ${bind(query)}) > 0` : ''}`);
    const folder = request.folderId;
    const membership = folder ? `WHERE ${folder === '__unfiled__' ? 'NOT ' : ''}EXISTS (
      SELECT 1 FROM folder_memberships m JOIN folders f ON f.id = m.folder_id AND f.deleted_at IS NULL
      WHERE m.target_kind = source.kind AND m.target_id = source.id AND json_valid(m.body)
        AND json_type(m.body, '$.deletedAt') IS NULL
        ${folder === '__unfiled__' ? '' : `AND m.folder_id = ${bind(folder)}`})` : '';
    const cte = `WITH source AS (${sources.join(' UNION ALL ')}), filtered AS (
      SELECT kind, id, body, json_extract(body, '$.createdAt') AS created_at,
        json_extract(body, '$.updatedAt') AS updated_at FROM source ${membership})`;
    const total = Number(this.database.prepare(`${cte} SELECT COUNT(*) AS count FROM filtered`).get(...params)?.count ?? 0);
    let page = Math.min(request.page ?? 0, Math.max(0, Math.ceil(total / FOLDER_PAGE_SIZE) - 1));
    let selectedPage: number | null = null;
    let order = `${request.sort === 'created-desc' ? 'created_at' : 'updated_at'} DESC, id ASC, kind ASC`;
    let orderedCte = cte, orderedParams = [...params];
    if (request.sort === 'title-asc') {
      // Full titles/IDs preserve locale collation for long questions; page summaries remain bounded SQL projections.
      const locale = resolveLocale(request.locale ?? 'en');
      const collator = new Intl.Collator(locale === 'zhCN' ? 'zh-CN' : locale === 'zhTW' ? 'zh-TW' : 'en', { sensitivity: 'base', numeric: true });
      const titles = this.database.prepare(`${cte} SELECT kind, id, ${title} AS title FROM filtered`).all(...params);
      titles.sort((a, b) => collator.compare(String(a.title), String(b.title)) || String(a.id).localeCompare(String(b.id)) || String(a.kind).localeCompare(String(b.kind)));
      const ranks = titles.map(row => ({ kind: row.kind, id: row.id }));
      orderedCte += `, ranks AS (SELECT CAST(key AS INTEGER) AS position, json_extract(value, '$.kind') AS rank_kind,
        json_extract(value, '$.id') AS rank_id FROM json_each(?)), ordered AS (
        SELECT filtered.*, ranks.position FROM filtered JOIN ranks ON kind = rank_kind AND id = rank_id)`;
      orderedParams.push(JSON.stringify(ranks)); order = 'position ASC';
    }
    const table = request.sort === 'title-asc' ? 'ordered' : 'filtered';
    if (request.selected) {
      const selected = this.database.prepare(`${orderedCte}, numbered AS (
        SELECT kind, id, row_number() OVER (ORDER BY ${order}) - 1 AS position FROM ${table})
        SELECT position FROM numbered WHERE kind = ? AND id = ?`).get(...orderedParams, request.selected.kind, request.selected.id);
      if (selected) selectedPage = Math.floor(Number(selected.position) / FOLDER_PAGE_SIZE);
      if (request.locateSelected) page = selectedPage ?? 0;
    } else if (request.locateSelected) page = 0;
    const items = this.database.prepare(`${orderedCte} SELECT ${summary} FROM ${table}
      ORDER BY ${order} LIMIT ? OFFSET ?`).all(...orderedParams, FOLDER_PAGE_SIZE, page * FOLDER_PAGE_SIZE)
      .flatMap(row => readJson<FolderContentSummary>(row) ?? []);
    const selectedTargets = request.selectedTargets?.length ? this.database.prepare(`${cte} SELECT DISTINCT target.kind, target.id
      FROM json_each(?) selection JOIN filtered target ON json_extract(selection.value, '$.kind') = target.kind
        AND json_extract(selection.value, '$.id') = target.id`).all(...params, JSON.stringify(request.selectedTargets)) : [];
    const live = new Set(selectedTargets.map(row => key(row.kind, row.id)));
    return { items, total, page, selectedPage, selected: selectedPage === null ? null : request.selected ?? null,
      selectedTargets: (request.selectedTargets ?? []).filter(target => live.has(key(target.kind, target.id))) };
  }
}
