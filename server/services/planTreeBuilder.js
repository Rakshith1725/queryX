import db from '../db/index.js';

export async function buildTreeFromDB(queryId) {
  const result = await db.query(
    `WITH RECURSIVE plan_tree AS (
       -- Base case: root node
       SELECT
         id, parent_node_id, node_type, relation_name,
         total_cost, startup_cost, actual_rows, plan_rows,
         actual_loops, heat_score, node_details,
         0 AS depth,
         ARRAY[id] AS path
       FROM execution_plan_nodes
       WHERE query_id = $1 AND parent_node_id IS NULL

       UNION ALL

       -- Recursive case: children
       SELECT
         n.id, n.parent_node_id, n.node_type, n.relation_name,
         n.total_cost, n.startup_cost, n.actual_rows, n.plan_rows,
         n.actual_loops, n.heat_score, n.node_details,
         pt.depth + 1,
         pt.path || n.id
       FROM execution_plan_nodes n
       INNER JOIN plan_tree pt ON n.parent_node_id = pt.id
       WHERE n.query_id = $1
     )
     SELECT * FROM plan_tree ORDER BY depth, path`,
    [queryId]
  );

  return buildNestedTree(result.rows);
}


function buildNestedTree(rows) {
  if (!rows.length) return null;

  const map = {};

  rows.forEach(row => {
    map[row.id] = {
      id: row.id,
      nodeType: row.node_type,
      relationName: row.relation_name,
      totalCost: parseFloat(row.total_cost),
      startupCost: parseFloat(row.startup_cost),
      actualRows: row.actual_rows,
      planRows: row.plan_rows,
      actualLoops: row.actual_loops,
      heatScore: parseFloat(row.heat_score),
      depth: row.depth,
      children: [],
    };
  });

  let root = null;

  rows.forEach(row => {
    if (row.parent_node_id === null) {
      root = map[row.id];
    } else if (map[row.parent_node_id]) {
      map[row.parent_node_id].children.push(map[row.id]);
    }
  });

  return root;
}