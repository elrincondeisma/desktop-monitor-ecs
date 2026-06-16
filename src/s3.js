const {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { fromIni } = require('@aws-sdk/credential-providers');

// Capa única que habla con S3 (SDK v3), en modo SOLO LECTURA.
// Nunca se exponen PutObject/DeleteObject: la app jamás escribe en S3.
//
// Solo nos interesan los buckets de configuración por entorno, cuyo nombre
// termina en "-env" (contienen los .env de los microservicios).
const ENV_BUCKET_SUFFIX = '-env';

// Tamaño máximo que servimos al visor (los .env son pequeños; este tope
// evita cargar en memoria un objeto enorme si alguien sube algo raro).
const MAX_OBJECT_BYTES = 1024 * 1024; // 1 MiB

const credsFor = (profile) => (profile ? fromIni({ profile }) : undefined);

// ListBuckets es global, pero leer objetos exige hablar con la región real
// del bucket. Cacheamos un cliente por (profile|region) para no recrearlos.
const clientCache = new Map();
function s3Client(profile, region) {
  const key = `${profile || ''}|${region}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new S3Client({ region, credentials: credsFor(profile) });
    clientCache.set(key, client);
  }
  return client;
}

// GetBucketLocation devuelve null/"" para us-east-1 y el alias legacy "EU"
// para eu-west-1; el resto ya es el nombre de región tal cual.
function normalizeRegion(locationConstraint) {
  if (!locationConstraint) return 'us-east-1';
  if (locationConstraint === 'EU') return 'eu-west-1';
  return locationConstraint;
}

async function bucketRegion(client, bucket) {
  const res = await client.send(new GetBucketLocationCommand({ Bucket: bucket }));
  return normalizeRegion(res.LocationConstraint);
}

// Lista los buckets *-env de la cuenta y resuelve la región de cada uno.
// `region` es solo la región inicial para el ListBuckets (es global, pero
// el cliente necesita una).
async function listEnvBuckets({ profile, region }) {
  const base = s3Client(profile, region || 'us-east-1');
  const res = await base.send(new ListBucketsCommand({}));
  const all = res.Buckets || [];
  const envBuckets = all.filter((b) => (b.Name || '').endsWith(ENV_BUCKET_SUFFIX));

  // Resolvemos la región en paralelo; si falla, dejamos la región base.
  return Promise.all(
    envBuckets
      .sort((a, b) => a.Name.localeCompare(b.Name))
      .map(async (b) => {
        let bRegion = region || 'us-east-1';
        try {
          bRegion = await bucketRegion(base, b.Name);
        } catch {
          /* sin permiso de GetBucketLocation: usamos la región base */
        }
        return {
          name: b.Name,
          region: bRegion,
          createdAt: b.CreationDate ? b.CreationDate.toISOString() : null,
        };
      })
  );
}

// Lista los objetos del bucket (los .env por entorno). Paginado completo.
async function listEnvObjects({ profile, bucket, region }) {
  const client = s3Client(profile, region);
  const objects = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })
    );
    for (const o of res.Contents || []) {
      // Saltamos los "directorios" (keys que acaban en /)
      if (o.Key.endsWith('/')) continue;
      objects.push({
        key: o.Key,
        size: o.Size,
        lastModified: o.LastModified ? o.LastModified.toISOString() : null,
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}

// Descarga el contenido de un objeto como texto, para el visor de solo lectura.
async function getEnvObject({ profile, bucket, key, region }) {
  const client = s3Client(profile, region);
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const size = res.ContentLength ?? 0;
  if (size > MAX_OBJECT_BYTES) {
    throw new Error(`El fichero es demasiado grande para el visor (${size} bytes).`);
  }
  const body = await res.Body.transformToString('utf-8');
  return {
    key,
    body,
    size,
    lastModified: res.LastModified ? res.LastModified.toISOString() : null,
  };
}

module.exports = { listEnvBuckets, listEnvObjects, getEnvObject };
