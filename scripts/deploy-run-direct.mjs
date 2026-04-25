import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECT_ID = 'recruit-pro';
const REGION = 'us-west1';
const SERVICE_NAME = 'dinkly';
const SERVICE_RESOURCE = `projects/${PROJECT_ID}/locations/${REGION}/services/${SERVICE_NAME}`;
const PRIMARY_URL = 'https://dinkly.net';
const RUN_URL = 'https://dinkly-715753958407.us-west1.run.app';
const STORAGE_BUCKET = 'ai-studio-bucket-715753958407-us-west1';
const TOKEN_PATH = path.resolve('.config/configstore/firebase-tools.json');
const FIREBASE_CONFIG_PATH = path.resolve('firebase.json');

function log(message) {
  console.log(`[deploy:run-direct] ${message}`);
}

function loadAccessToken() {
  const config = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  const token = config?.tokens?.access_token;
  if (!token) {
    throw new Error(`Missing Firebase access token in ${TOKEN_PATH}. Run firebase login from this folder first.`);
  }
  return token;
}

async function googleJson(url, { method = 'GET', token, body, contentType = 'application/json' } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': contentType } : {}),
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${url} failed: ${response.status} ${text}`);
  }

  return response.json();
}

function buildArchive() {
  const workingDir = mkdtempSync(path.join(tmpdir(), 'dinkly-run-direct-'));
  const archivePath = path.join(workingDir, 'build_artifacts.tar.gz');

  log('Building production bundle...');
  execFileSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      LC_ALL: 'C',
    },
  });

  execFileSync(
    'tar',
    [
      '--exclude=.git',
      '--exclude=.config',
      '--exclude=.firebase',
      '--exclude=node_modules',
      '--exclude=.env.local',
      '--exclude=firebase-debug.log',
      '-czf',
      archivePath,
      '.',
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        LC_ALL: 'C',
      },
    }
  );

  return { workingDir, archivePath };
}

function getFirestoreReleaseNames() {
  const firebaseConfig = JSON.parse(readFileSync(FIREBASE_CONFIG_PATH, 'utf8'));
  const firestoreEntries = Array.isArray(firebaseConfig.firestore)
    ? firebaseConfig.firestore
    : firebaseConfig.firestore
      ? [firebaseConfig.firestore]
      : [];

  return firestoreEntries
    .map((entry) => entry?.database)
    .filter(Boolean)
    .map((databaseId) => (
      databaseId === '(default)'
        ? `projects/${PROJECT_ID}/releases/cloud.firestore`
        : `projects/${PROJECT_ID}/releases/cloud.firestore/${databaseId}`
    ));
}

async function deployFirestoreRules(token) {
  log('Publishing Firestore rules...');
  const rulesContent = readFileSync(path.resolve('firestore.rules'), 'utf8');

  const ruleset = await googleJson(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      source: {
        files: [
          {
            name: 'firestore.rules',
            content: rulesContent,
          },
        ],
      },
    }),
  });

  const releaseNames = getFirestoreReleaseNames();
  for (const releaseName of releaseNames) {
    await googleJson(`https://firebaserules.googleapis.com/v1/${releaseName}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({
        release: {
          name: releaseName,
          rulesetName: ruleset.name,
        },
        updateMask: 'ruleset_name',
      }),
    });
  }

  log(`Firestore rules live on ${releaseNames.length} release${releaseNames.length === 1 ? '' : 's'} via ${ruleset.name}`);
}

async function uploadArchive(token, archivePath) {
  const version = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const objectName = `services/${SERVICE_NAME}/${version}/compiled/build_artifacts.tar.gz`;
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${STORAGE_BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const archive = readFileSync(archivePath);

  const uploaded = await googleJson(uploadUrl, {
    method: 'POST',
    token,
    body: archive,
    contentType: 'application/gzip',
  });

  return {
    objectName,
    generation: uploaded.generation,
  };
}

function buildDirectServiceBody(service, sourceObject) {
  const appContainer = service.template?.containers?.find((container) => container.name === 'app-container');
  if (!appContainer) {
    throw new Error('Could not locate app-container on the existing Cloud Run service.');
  }

  return {
    name: service.name,
    etag: service.etag,
    template: {
      containers: [
        {
          name: 'app-container',
          image: 'scratch',
          command: ['/bin/sh'],
          args: ['-c', 'npm start'],
          env: [
            { name: 'VITE_ACCESS_CODE', value: appContainer.env?.find((env) => env.name === 'VITE_ACCESS_CODE')?.value || '1303' },
            { name: 'APP_URL', value: PRIMARY_URL },
          ],
          resources: appContainer.resources,
          ports: [
            {
              name: 'http1',
              containerPort: 8080,
            },
          ],
          startupProbe: {
            timeoutSeconds: 240,
            periodSeconds: 240,
            failureThreshold: 1,
            tcpSocket: {
              port: 8080,
            },
          },
          baseImageUri: appContainer.baseImageUri,
          sourceCode: {
            cloudStorageSource: {
              bucket: STORAGE_BUCKET,
              object: sourceObject.objectName,
              generation: sourceObject.generation,
            },
          },
        },
      ],
    },
  };
}

async function waitForOperation(token, operationName) {
  const operationUrl = `https://run.googleapis.com/v2/${operationName}`;

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const operation = await googleJson(operationUrl, { token });
    if (operation.done) return operation;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Timed out waiting for ${operationName}`);
}

async function main() {
  log(`Primary deploy target: ${PRIMARY_URL}`);
  log(`Cloud Run service URL: ${RUN_URL}`);
  const token = loadAccessToken();
  await deployFirestoreRules(token);
  const { workingDir, archivePath } = buildArchive();

  try {
    log('Uploading source bundle...');
    const uploaded = await uploadArchive(token, archivePath);
    log(`Uploaded to gs://${STORAGE_BUCKET}/${uploaded.objectName}`);

    log('Fetching current Cloud Run service...');
    const service = await googleJson(`https://run.googleapis.com/v2/${SERVICE_RESOURCE}`, { token });
    const body = buildDirectServiceBody(service, uploaded);

    log('Rolling Cloud Run service to direct app container mode...');
    const operation = await googleJson(
      `https://run.googleapis.com/v2/${SERVICE_RESOURCE}?updateMask=template.containers`,
      {
        method: 'PATCH',
        token,
        body: JSON.stringify(body),
      }
    );

    log(`Waiting for operation ${operation.name.split('/').pop()}...`);
    const finished = await waitForOperation(token, operation.name);
    const deployedService = finished.response ?? finished.metadata;

    log(`Revision ready: ${deployedService.latestReadyRevision}`);
    log(`Production URL: ${PRIMARY_URL}`);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[deploy:run-direct] ${error.message}`);
  process.exit(1);
});
