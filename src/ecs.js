const {
  ECSClient,
  ListClustersCommand,
  DescribeClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  ListTasksCommand,
  DescribeTasksCommand,
  ListContainerInstancesCommand,
  DescribeContainerInstancesCommand,
} = require('@aws-sdk/client-ecs');
const { fromIni } = require('@aws-sdk/credential-providers');
const { loadSharedConfigFiles } = require('@aws-sdk/shared-ini-file-loader');

async function listProfiles() {
  const { configFile = {}, credentialsFile = {} } = await loadSharedConfigFiles();
  const names = new Set([...Object.keys(credentialsFile), ...Object.keys(configFile)]);
  return [...names].sort().map((name) => ({
    name,
    region: configFile[name]?.region || credentialsFile[name]?.region || null,
  }));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function paginate(client, Command, input, listKey) {
  const items = [];
  let nextToken;
  do {
    const res = await client.send(new Command({ ...input, nextToken }));
    items.push(...(res[listKey] || []));
    nextToken = res.nextToken;
  } while (nextToken);
  return items;
}

function shortTaskDef(arn) {
  // arn:aws:ecs:region:acct:task-definition/family:revision -> family:revision
  return arn ? arn.split('/').pop() : null;
}

async function fetchServices(client, cluster) {
  const serviceArns = await paginate(client, ListServicesCommand, { cluster, maxResults: 100 }, 'serviceArns');
  const services = [];
  for (const batch of chunk(serviceArns, 10)) {
    const res = await client.send(new DescribeServicesCommand({ cluster, services: batch }));
    services.push(...(res.services || []));
  }
  return services
    .map((s) => {
      const primary = (s.deployments || []).find((d) => d.status === 'PRIMARY');
      return {
        name: s.serviceName,
        status: s.status,
        desired: s.desiredCount,
        running: s.runningCount,
        pending: s.pendingCount,
        launchType: s.launchType || (s.capacityProviderStrategy ? 'CAPACITY_PROVIDER' : null),
        taskDef: shortTaskDef(s.taskDefinition),
        deploymentsCount: (s.deployments || []).length,
        rolloutState: primary?.rolloutState || null,
        rolloutReason: primary?.rolloutStateReason || null,
        deploymentRunning: primary?.runningCount ?? null,
        deploymentDesired: primary?.desiredCount ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchTasks(client, cluster) {
  const [runningArns, stoppedArns] = await Promise.all([
    paginate(client, ListTasksCommand, { cluster, desiredStatus: 'RUNNING', maxResults: 100 }, 'taskArns'),
    paginate(client, ListTasksCommand, { cluster, desiredStatus: 'STOPPED', maxResults: 100 }, 'taskArns'),
  ]);
  const arns = [...new Set([...runningArns, ...stoppedArns])];
  const tasks = [];
  for (const batch of chunk(arns, 100)) {
    const res = await client.send(new DescribeTasksCommand({ cluster, tasks: batch }));
    tasks.push(...(res.tasks || []));
  }
  return tasks.map((t) => ({
    arn: t.taskArn,
    id: (t.taskArn || '').split('/').pop().slice(0, 8),
    group: t.group,
    serviceName: t.group && t.group.startsWith('service:') ? t.group.slice(8) : null,
    createdAt: t.createdAt || null,
    taskDef: shortTaskDef(t.taskDefinitionArn),
    lastStatus: t.lastStatus,
    desiredStatus: t.desiredStatus,
    health: t.healthStatus,
    launchType: t.launchType,
    az: t.availabilityZone,
    startedAt: t.startedAt || null,
    stoppedAt: t.stoppedAt || null,
    stoppedReason: t.stoppedReason || null,
    cpu: t.cpu,
    memory: t.memory,
  }));
}

async function fetchInstances(client, cluster) {
  const arns = await paginate(client, ListContainerInstancesCommand, { cluster, maxResults: 100 }, 'containerInstanceArns');
  if (!arns.length) return [];
  const instances = [];
  for (const batch of chunk(arns, 100)) {
    const res = await client.send(new DescribeContainerInstancesCommand({ cluster, containerInstances: batch }));
    instances.push(...(res.containerInstances || []));
  }
  const resource = (list, name) => (list || []).find((r) => r.name === name)?.integerValue ?? null;
  return instances.map((i) => ({
    ec2InstanceId: i.ec2InstanceId,
    status: i.status,
    statusReason: i.statusReason || null,
    agentConnected: i.agentConnected,
    runningTasks: i.runningTasksCount,
    pendingTasks: i.pendingTasksCount,
    instanceType: (i.attributes || []).find((a) => a.name === 'ecs.instance-type')?.value || null,
    cpuRemaining: resource(i.remainingResources, 'CPU'),
    cpuRegistered: resource(i.registeredResources, 'CPU'),
    memRemaining: resource(i.remainingResources, 'MEMORY'),
    memRegistered: resource(i.registeredResources, 'MEMORY'),
  }));
}

async function fetchState({ profile, region }) {
  const client = new ECSClient({
    region,
    credentials: profile ? fromIni({ profile }) : undefined,
  });
  const clusterArns = await paginate(client, ListClustersCommand, { maxResults: 100 }, 'clusterArns');
  if (!clusterArns.length) return { clusters: [], fetchedAt: new Date().toISOString() };

  const described = [];
  for (const batch of chunk(clusterArns, 100)) {
    const res = await client.send(new DescribeClustersCommand({ clusters: batch }));
    described.push(...(res.clusters || []));
  }

  const clusters = await Promise.all(
    described
      .sort((a, b) => a.clusterName.localeCompare(b.clusterName))
      .map(async (c) => {
        const [services, tasks, instances] = await Promise.all([
          fetchServices(client, c.clusterArn),
          fetchTasks(client, c.clusterArn),
          fetchInstances(client, c.clusterArn),
        ]);
        return {
          name: c.clusterName,
          status: c.status,
          runningTasks: c.runningTasksCount,
          pendingTasks: c.pendingTasksCount,
          activeServices: c.activeServicesCount,
          registeredInstances: c.registeredContainerInstancesCount,
          services,
          tasks,
          instances,
        };
      })
  );

  return { clusters, fetchedAt: new Date().toISOString() };
}

module.exports = { listProfiles, fetchState };
