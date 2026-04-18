import crypto from 'crypto';

function scoreAndAnnotate(planJson) {
 
  const root = planJson?.['Plan'] || planJson?.[0]?.['Plan'] || planJson;
  if (!root) 
    return { costScore: 0, nodes: [] };

  const nodes = [];
  flattenNodes(root, null, nodes);

 const maxCost = nodes.length? Math.max(...nodes.map(n => n.total_cost)) : 1;

  nodes.forEach(n => {
    n.heat_score = parseFloat((n.total_cost / maxCost).toFixed(3));
  });

 
  const totalCost = root['Total Cost'] || 0;
  const costScore = Math.max(
    1,
    Math.min(100, Math.round(100 - Math.log10(totalCost + 1) * 15))
  );

  return { costScore, nodes };
}

function flattenNodes(node, parentId, result) {
  const id = crypto.randomUUID();

  result.push({
    id,
    parent_node_id: parentId,
    node_type: node['Node Type'] || 'Unknown',
    relation_name: node['Relation Name'] || null,
    total_cost: node['Total Cost'] || 0,
    startup_cost: node['Startup Cost'] || 0,
    actual_rows: node['Actual Rows'] ?? null,
    plan_rows: node['Plan Rows'] || 0,
    actual_loops: node['Actual Loops'] ?? 1,
    heat_score: 0, 
    node_details: node,
  });

  const children = node['Plans'] || [];
  children.forEach(child => flattenNodes(child, id, result));
}

export { scoreAndAnnotate };