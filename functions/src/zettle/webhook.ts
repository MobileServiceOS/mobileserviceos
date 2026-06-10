// functions/src/zettle/webhook.ts
// ═══════════════════════════════════════════════════════════════════
//  zettleWebhook — public HTTPS endpoint for Zettle (Pusher API)
//  PurchaseCreated events. Mirrors the twilioVoiceStatus pattern:
//    • POST only.
//    • Verify the per-business signingKey over the RAW body.
//    • Route org → business via the zettleOrgs index.
//    • Fetch the full purchase, persist + match (persistAndMatch).
//    • Always 200 on internal errors (no Pusher retry storm); 403 only
//      on a forged signature.
//
//  Ships DORMANT (ZETTLE_ENABLED). Activate by registering the MSOS
//  Zettle app, setting the secrets, and connecting a merchant (which
//  creates the subscription pointing here).
// ═══════════════════════════════════════════════════════════════════

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ZETTLE_ENABLED, ZETTLE_SECRETS } from '../lib/zettleEnabled';
import { assertValidZettleSignature, ZettleSignatureError } from '../lib/zettleSignature';
import { getValidAccessToken, loadPrivate } from './tokens';
import { getPurchase } from '../lib/zettleClient';
import { persistAndMatch } from './applyMatch';

export const zettleWebhook = onRequest(
  { cors: false, secrets: [...ZETTLE_SECRETS, 'MAP_STATIC_API_KEY'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('method not allowed'); return; }
    if (!ZETTLE_ENABLED) { res.status(200).send('dormant'); return; }

    const rawBody = (req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {}));
    let msg: { organizationUuid?: string; eventName?: string; payload?: unknown; signature?: string; timestamp?: string };
    try {
      msg = typeof req.body === 'object' && req.body ? req.body : JSON.parse(rawBody);
    } catch {
      res.status(200).send('bad json'); return;
    }

    const orgUuid = msg.organizationUuid;
    if (!orgUuid) { res.status(200).send('no org'); return; }

    try {
      const db = admin.firestore();

      // Route org → business.
      const orgSnap = await db.doc(`zettleOrgs/${orgUuid}`).get();
      const businessId = orgSnap.exists ? (orgSnap.get('businessId') as string) : undefined;
      if (!businessId) { res.status(200).send('unknown org'); return; }

      // Signature: per-business signingKey from subscription creation.
      const priv = await loadPrivate(db, businessId);
      const sigHeader = (req.header('x-zettle-signature') ?? req.header('x-izettle-signature') ?? msg.signature) || undefined;
      const payloadStr = typeof msg.payload === 'string' ? msg.payload : (msg.payload != null ? JSON.stringify(msg.payload) : undefined);
      try {
        assertValidZettleSignature({
          rawBody,
          signatureHeader: sigHeader,
          signingKey: priv?.signingKey ?? null,
          timestamp: msg.timestamp,
          payload: payloadStr,
        });
      } catch (err) {
        if (err instanceof ZettleSignatureError) {
          console.error('[zettleWebhook] invalid signature', { orgUuid, businessId });
          res.status(403).send('invalid signature');
          return;
        }
        throw err;
      }

      if (msg.eventName && msg.eventName !== 'PurchaseCreated') {
        res.status(200).send('ignored'); return;
      }

      // Extract the purchase UUID from the event payload.
      const payload = typeof msg.payload === 'string'
        ? JSON.parse(msg.payload) as Record<string, unknown>
        : (msg.payload as Record<string, unknown> | undefined) ?? {};
      const purchaseUuid = String(
        payload.purchaseUuid ?? payload.purchaseUUID ?? payload.purchaseUUID1 ?? '',
      );
      if (!purchaseUuid) { res.status(200).send('no purchase uuid'); return; }

      // Fetch the full purchase (the webhook payload is minimal).
      const accessToken = await getValidAccessToken(db, businessId);
      const purchase = await getPurchase(accessToken, purchaseUuid);

      const autoMatch = await db.doc(`businesses/${businessId}/operational_settings/main`)
        .get().then((s) => s.get('zettleAutoMatchEnabled') !== false);

      const result = await persistAndMatch(db, businessId, purchase, 'webhook', { autoMatch });
      console.info('[zettleWebhook] processed', { businessId, ...result });
      res.status(200).send('ok');
    } catch (err) {
      // Internal error AFTER signature check — 200 so Pusher doesn't
      // hammer us; the record can be re-imported via historical sync.
      console.error('[zettleWebhook] internal error', (err as Error).message);
      res.status(200).send('error-logged');
    }
  },
);
