import { getNeo4jSession, closeNeo4jDriver } from "../lib/neo4j/client";

async function main() {
  const session = await getNeo4jSession();
  
  // Count experiments
  const countResult = await session.run('MATCH (e:Experiment) RETURN count(e) as total');
  const total = countResult.records[0].get('total').toNumber();
  console.log('Total Experiments in Neo4j:', total);
  
  // Count relationships
  const relResult = await session.run('MATCH ()-[r]->() RETURN type(r) as type, count(r) as count ORDER BY count DESC');
  console.log('\nRelationships:');
  relResult.records.forEach(r => {
    console.log('  -', r.get('type'), ':', r.get('count').toNumber());
  });
  
  // Count node types
  const nodeResult = await session.run('MATCH (n) RETURN labels(n)[0] as label, count(n) as count ORDER BY count DESC');
  console.log('\nNode Types:');
  nodeResult.records.forEach(r => {
    console.log('  -', r.get('label'), ':', r.get('count').toNumber());
  });
  
  await session.close();
  await closeNeo4jDriver();
}

main().catch(console.error);
