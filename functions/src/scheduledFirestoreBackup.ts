import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

// ─────────────────────────────────────────────────────────────────────
//  scheduledFirestoreBackup — daily managed export of the entire
//  Firestore database to a GCS bucket. Disaster recovery for the
//  hosted Firestore instance.
//
//  Why managed exports vs. a custom dump:
//    - Native Firestore export is consistent across collections at a
//      point in time. A custom collection-by-collection dump would
//      be racey under concurrent writes.
//    - Exports use the Firestore Admin API; Firebase Functions has
//      the credentials baked in via the default service account.
//    - Imports back into Firestore (full or partial) use the same
//      managed format.
//
//  What this function does:
//    Once per day at 03:00 America/New_York, calls
//    firestore.googleapis.com:exportDocuments with
//    outputUriPrefix pointing at gs://<projectId>-firestore-backups/<timestamp>/.
//    The Firestore backup process runs server-side; the function
//    returns as soon as the export operation is QUEUED, not when it
//    completes.
//
//  Pre-deploy operator setup (one-time, NOT in code):
//
//    1. Create the GCS bucket. Replace <project-id>:
//
//         gsutil mb -l us-central1 gs://<project-id>-firestore-backups
//
//       The bucket MUST be in the same region as your Firestore database
//       (us-central1 for mobile-service-os). Cross-region exports fail
//       with PERMISSION_DENIED.
//
//    2. Grant the Firebase Functions service account permission to
//       export Firestore and write to the GCS bucket:
//
//         gcloud projects add-iam-policy-binding <project-id> \
//           --member=serviceAccount:<project-id>@appspot.gserviceaccount.com \
//           --role=roles/datastore.importExportAdmin
//
//         gsutil iam ch serviceAccount:<project-id>@appspot.gserviceaccount.com:roles/storage.admin \
//           gs://<project-id>-firestore-backups
//
//    3. (Optional but recommended) Set a 30-day GCS lifecycle policy
//       on the bucket so old backups age out automatically:
//
//         echo '{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 30}}]}' > lifecycle.json
//         gsutil lifecycle set lifecycle.json gs://<project-id>-firestore-backups
//
//    4. Deploy the function:
//
//         firebase deploy --only functions:scheduledFirestoreBackup --project mobile-service-os
//
//    5. Verify:
//
//         firebase functions:log --only scheduledFirestoreBackup --project mobile-service-os
//
//       The next scheduled run logs "Export queued: <operation-name>".
//       After ~5 minutes (depends on database size), the GCS bucket
//       has a new dated folder.
//
//  Restore (manual, when needed):
//
//    gcloud firestore import gs://<project-id>-firestore-backups/<timestamp>/
//
//  This restores the ENTIRE database from the named export. Selective
//  collection imports use --collection-ids.
//
//  Cost (rough estimate, free tier accounted for):
//    - Export operation: ~$0 (within Firestore free tier reads)
//    - GCS storage: ~$0.02 per GB-month standard storage
//    - For a 100MB database, 30 daily backups: $0.06/month
//
//  References:
//    https://firebase.google.com/docs/firestore/solutions/schedule-export
//    https://cloud.google.com/firestore/docs/manage-data/export-import
// ─────────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'mobile-service-os';
const BACKUP_BUCKET = `gs://${PROJECT_ID}-firestore-backups`;

export const scheduledFirestoreBackup = functions
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .pubsub
  .schedule('every day 03:00')
  .timeZone('America/New_York')
  .onRun(async () => {
    // Datestamp folder name — sortable + readable in the bucket UI.
    // Format: 2026-05-27T0300Z (no separators that break GCS paths).
    const now = new Date();
    const datePart = now.toISOString().split('T')[0];
    const timePart = now.toISOString().split('T')[1].split(':').slice(0, 2).join('') + 'Z';
    const folder = `${datePart}T${timePart}`;
    const outputUriPrefix = `${BACKUP_BUCKET}/${folder}`;

    // Use firebase-admin's bundled credential to get an access token.
    // The functions runtime auto-injects the service account so no
    // explicit key file is needed. firebase-admin v12+ resolves a
    // GoogleAuth-shape credential that includes the datastore scope.
    const tokenResult = await admin.app().options.credential!.getAccessToken();
    const accessToken = tokenResult.access_token;
    if (!accessToken) {
      // eslint-disable-next-line no-console
      console.error('[firestoreBackup] failed to obtain access token');
      throw new Error('No access token');
    }

    // Firestore Admin API export endpoint.
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default):exportDocuments`;
    const body = {
      outputUriPrefix,
      // Empty array = export ALL collections. Selective backups would
      // list collectionIds explicitly.
      collectionIds: [],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      // eslint-disable-next-line no-console
      console.error('[firestoreBackup] export request failed', {
        status: res.status,
        detail: detail.slice(0, 500),
      });
      throw new Error(`Export request failed: ${res.status}`);
    }
    const data = await res.json() as { name?: string };
    // eslint-disable-next-line no-console
    console.info('[firestoreBackup] export queued', {
      operationName: data.name,
      outputUriPrefix,
    });
  });
