// Prints a dashboard of observability/grafana/dashboards adapted to Grafana Cloud, ready to paste into
// Dashboards -> New -> Import:   node scripts/grafana-cloud-dashboards.mjs services | pbcopy
// The differences: Grafana Cloud's data sources, and the server's own CPU and memory in place of cAdvisor's
// per-container numbers (cAdvisor does not run on a small server).
import { readFileSync } from 'node:fs';

const name = process.argv[2];
if (!['services', 'logs'].includes(name)) {
  console.error('usage: node scripts/grafana-cloud-dashboards.mjs services|logs');
  process.exit(1);
}
const SOURCES = { prometheus: 'grafanacloud-prom', loki: 'grafanacloud-logs' };
const HOST_PANELS = {
  'CPU by container': {
    title: 'Server CPU in use',
    unit: 'percentunit',
    legend: 'CPU',
    expr: '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))',
  },
  'Memory by container': {
    title: 'Server memory in use',
    unit: 'bytes',
    legend: 'memory',
    expr: 'node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes',
    second: { legend: 'swap', expr: 'node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes' },
  },
};

const dashboard = JSON.parse(readFileSync(new URL(`../observability/grafana/dashboards/${name}.json`, import.meta.url), 'utf8'));
const walk = (x) => {
  if (Array.isArray(x)) return x.forEach(walk);
  if (!x || typeof x !== 'object') return;
  if (x.datasource?.uid in SOURCES) x.datasource.uid = SOURCES[x.datasource.uid];
  const host = HOST_PANELS[x.title];
  if (host && Array.isArray(x.targets)) {
    x.title = host.title;
    const [first] = x.targets;
    x.targets = [{ ...first, refId: 'A', expr: host.expr, legendFormat: host.legend }];
    if (host.second) x.targets.push({ ...first, refId: 'B', expr: host.second.expr, legendFormat: host.second.legend });
    x.fieldConfig.defaults.unit = host.unit;
  }
  Object.values(x).forEach(walk);
};
walk(dashboard);
dashboard.id = null;
dashboard.title = dashboard.title.replace('Cambo Supply', 'Cambo Keyboard Supply');
console.log(JSON.stringify(dashboard));
