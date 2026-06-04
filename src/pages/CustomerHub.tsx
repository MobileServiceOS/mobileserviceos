// src/pages/CustomerHub.tsx
// ═══════════════════════════════════════════════════════════════════
//  CustomerHub — SP1 skeleton.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"SP1 — Customer + Vehicle entities + saveJob upsert"
//         · top-level Customers nav route + skeleton CustomerHub page
//
//  In SP1 this page renders the existing src/pages/Customers.tsx so
//  the operator's day-to-day Customers list is reachable from the new
//  top-level tab with zero functional regression. Full Customer Hub
//  content (filters, search, profile drill-down, insights) lands in
//  SP3 — at which point this file widens, not the existing
//  Customers.tsx (which keeps its current responsibilities).
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
// Customers is a NAMED export (verified before edit) — use the named-import form.
import { Customers } from '@/pages/Customers';

interface Props {
  jobs: Job[];
  settings: Settings;
  onViewJob?: (j: Job) => void;
}

export default function CustomerHub(props: Props): JSX.Element {
  return (
    <div className="page-shell">
      {/* SP1 skeleton: defer entirely to the existing Customers page.
          SP3 will introduce a header/toolbar above this and a profile
          drill-down route. */}
      <Customers
        jobs={props.jobs}
        settings={props.settings}
        onViewJob={props.onViewJob}
      />
    </div>
  );
}
