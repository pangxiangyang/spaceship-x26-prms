#!/usr/bin/env bash
# Deploys the PRMS live demo to Google Cloud:
#   - Cloud Run service serving the API and the web app, storing data in Firestore
#   - Cloud Run job that resets the demo data, triggered daily by Cloud Scheduler
#
# Idempotent: creates whatever is missing and redeploys the current commit.
#
#   PROJECT_ID=my-project ./deploy/cloud-run.sh
#
# Requires gcloud signed in with owner rights on the project, plus git and openssl.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to the Google Cloud project to deploy to}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-prms}"
REPOSITORY="${REPOSITORY:-prms}"
RESET_JOB="${SERVICE}-demo-reset"
RESET_SCHEDULE="${RESET_SCHEDULE:-0 4 * * *}"
RESET_TIME_ZONE="${RESET_TIME_ZONE:-Asia/Singapore}"
# Published on the demo login page, so it is a demo value, not a secret.
DEMO_CREW_PASSWORD="${DEMO_CREW_PASSWORD:-mission-control}"

RUNTIME_SA="prms-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="prms-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
TAG="$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo '-dirty')"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/prms:${TAG}"

ENV_VARS="NODE_ENV=production,STORAGE=firestore,SEED_DEMO_DATA=true,TRUST_PROXY=1"
SECRETS="JWT_SECRET=prms-jwt-secret:latest,PRMS_CREW_LEADS=prms-crew-leads:latest"

g() { gcloud --project="$PROJECT_ID" --quiet "$@"; }
exists() { "$@" >/dev/null 2>&1; }
step() { printf '\n==> %s\n' "$*"; }

step "Enabling APIs"
g services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
  iam.googleapis.com

step "Firestore database"
exists g firestore databases describe --database='(default)' ||
  g firestore databases create --database='(default)' --location="$REGION" --type=firestore-native

step "Artifact Registry repository"
exists g artifacts repositories describe "$REPOSITORY" --location="$REGION" ||
  g artifacts repositories create "$REPOSITORY" --repository-format=docker \
    --location="$REGION" --description="Spaceship X26 PRMS images"

step "Service accounts"
exists g iam service-accounts describe "$RUNTIME_SA" ||
  g iam service-accounts create prms-runtime --display-name="PRMS runtime (Cloud Run)"
exists g iam service-accounts describe "$SCHEDULER_SA" ||
  g iam service-accounts create prms-scheduler --display-name="PRMS demo reset trigger"
# Read/write Firestore documents; nothing else project-wide.
g projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" \
  --role=roles/datastore.user --condition=None >/dev/null

step "Secrets"
ensure_secret() { # name value-if-new
  exists g secrets describe "$1" ||
    printf '%s' "$2" | g secrets create "$1" --replication-policy=automatic --data-file=-
  g secrets add-iam-policy-binding "$1" --member="serviceAccount:$RUNTIME_SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
}
crew_lead() { printf '{"username":"%s","displayName":"%s","password":"%s"}' "$1" "$2" "$DEMO_CREW_PASSWORD"; }
ensure_secret prms-jwt-secret "$(openssl rand -hex 32)"
ensure_secret prms-crew-leads "[$(crew_lead commander 'Cmdr. Ava Reyes'),$(crew_lead navigator 'Lt. Kenji Sato'),$(crew_lead medic 'Dr. Leila Haddad')]"

step "Building $IMAGE"
g builds submit --tag="$IMAGE" .

step "Deploying service $SERVICE"
# One instance: booking capacity is guarded by an in-process lock (see docs/DESIGN.md).
g run deploy "$SERVICE" --image="$IMAGE" --region="$REGION" \
  --service-account="$RUNTIME_SA" --allow-unauthenticated \
  --set-env-vars="$ENV_VARS" --set-secrets="$SECRETS" \
  --min-instances=0 --max-instances=1 --cpu=1 --memory=512Mi --cpu-boost

step "Deploying job $RESET_JOB"
g run jobs deploy "$RESET_JOB" --image="$IMAGE" --region="$REGION" \
  --service-account="$RUNTIME_SA" --command=node --args=packages/api/dist/reset-demo.js \
  --set-env-vars="$ENV_VARS" --set-secrets="$SECRETS" \
  --tasks=1 --max-retries=1 --task-timeout=15m --memory=512Mi

step "Scheduling the reset: '$RESET_SCHEDULE' ($RESET_TIME_ZONE)"
g run jobs add-iam-policy-binding "$RESET_JOB" --region="$REGION" \
  --member="serviceAccount:$SCHEDULER_SA" --role=roles/run.invoker >/dev/null
SCHEDULE_FLAGS=(
  --location="$REGION" --schedule="$RESET_SCHEDULE" --time-zone="$RESET_TIME_ZONE"
  --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${RESET_JOB}:run"
  --http-method=POST --oauth-service-account-email="$SCHEDULER_SA"
)
if exists g scheduler jobs describe "${RESET_JOB}-daily" --location="$REGION"; then
  g scheduler jobs update http "${RESET_JOB}-daily" "${SCHEDULE_FLAGS[@]}"
else
  g scheduler jobs create http "${RESET_JOB}-daily" "${SCHEDULE_FLAGS[@]}"
fi

URL="$(g run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
step "Live demo: $URL"
