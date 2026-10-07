import type { DatabaseSync } from 'node:sqlite';
import { isLocalDataStats, type LocalDataStats } from '../shared/local-data';

/** 单条只读 SELECT 给出一个快照；分类附带条数与 reset 的孤立记录范围不同。 */
export function readLocalDataStats(database: DatabaseSync): LocalDataStats {
  const row = database.prepare(`SELECT
    (SELECT COUNT(*) FROM questions WHERE deleted_at IS NULL) +
      (SELECT COUNT(*) FROM history WHERE deleted_at IS NULL) AS history,
    (SELECT COUNT(*) FROM archives WHERE deleted_at IS NULL) AS archives,
    (SELECT COUNT(*) FROM decisions WHERE deleted_at IS NULL) AS decisions,
    (SELECT COUNT(*) FROM folders WHERE deleted_at IS NULL) AS folders,
    (SELECT COUNT(*) FROM question_answers a JOIN questions q ON q.id=a.question_id
      WHERE a.deleted_at IS NULL AND q.deleted_at IS NULL) AS answers,
    (SELECT COUNT(*) FROM folder_memberships m JOIN folders f ON f.id=m.folder_id
      WHERE json_type(m.body,'$.deletedAt') IS NULL AND f.deleted_at IS NULL) AS memberships,
    (SELECT COUNT(*) FROM question_answers WHERE deleted_at IS NULL) AS reset_answers,
    (SELECT COUNT(*) FROM folder_memberships WHERE json_type(body,'$.deletedAt') IS NULL) AS reset_memberships,
    (SELECT COUNT(*) FROM state_items WHERE deleted_at IS NULL AND substr(key,1,9)='template:') AS templates,
    (SELECT COUNT(*) FROM state_items WHERE deleted_at IS NULL AND substr(key,1,6)='group:') AS groups,
    (SELECT COUNT(*) FROM state_items WHERE deleted_at IS NULL AND key='workspace') AS workspace
  `).get()!;
  const result = {history:row.history,archives:row.archives,decisions:row.decisions,folders:row.folders,
    answers:row.answers,memberships:row.memberships,reset:{answers:row.reset_answers,
      memberships:row.reset_memberships,templates:row.templates,groups:row.groups,workspace:row.workspace}};
  if (!isLocalDataStats(result)) throw new Error('invalid_request');
  return result;
}
