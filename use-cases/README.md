# SignatureAPI use-case examples (Node.js)

Nineteen runnable examples, one per industry workflow. Each folder has a zero-dependency Node.js script (`index.mjs`) that builds a `POST /v1/envelopes` request body and sends it in test mode, a `node --test` suite (offline checks plus a live check that is skipped without a key), and a README that explains the business problem and the envelope design.

## Run any example

```bash
export SIGNATUREAPI_KEY=key_test_YOUR_KEY   # a test key; live keys are refused
cd <use-case>
node index.mjs
npm test
```

Needs Node.js 20 or newer. No `npm install`.

| Use case | Industry | API features shown | Link |
|---|---|---|---|
| [hr-offer-letters](./hr-offer-letters/) | Human resources | DOCX template merge (`data`), approver then signer, sequential routing, metadata, topics, fixed positions | [README](./hr-offer-letters/README.md) |
| [staffing-onboarding](./staffing-onboarding/) | Staffing and recruiting | Bulk send from a CSV, automatic signer countersignature, metadata, topics | [README](./staffing-onboarding/README.md) |
| [real-estate](./real-estate/) | Real estate | Sequential routing with two signers, signing dates, metadata, topics | [README](./real-estate/README.md) |
| [property-management-leases](./property-management-leases/) | Property management | Parallel routing, three signers, initials, metadata, topics | [README](./property-management-leases/README.md) |
| [lending](./lending/) | Lending | Preparer, sequential routing, text input with capture, checkbox, two signers | [README](./lending/README.md) |
| [healthcare-consent](./healthcare-consent/) | Healthcare | Email link plus email code authentication, required checkbox with capture, opaque metadata | [README](./healthcare-consent/README.md) |
| [saas-order-forms](./saas-order-forms/) | SaaS sales | Automatic signer countersignature, dropdown with capture, checkbox, metadata | [README](./saas-order-forms/README.md) |
| [nonprofit-volunteers](./nonprofit-volunteers/) | Nonprofit | Parallel routing, initials and signature, branding, topics | [README](./nonprofit-volunteers/README.md) |
| [agencies-sow](./agencies-sow/) | Agencies and consulting | Several documents in one envelope, per-document places, sender, deliverable options | [README](./agencies-sow/README.md) |
| [insurance](./insurance/) | Insurance | Embedded ceremony via POST /v1/recipients/{id}/ceremonies, custom authentication, embeddable_in | [README](./insurance/README.md) |
| [education-enrollment](./education-enrollment/) | Education | Sequential routing, dropdown (predefined and custom options), radio group, text input with format, captures | [README](./education-enrollment/README.md) |
| [law-firm-engagement](./law-firm-engagement/) | Legal services | Approver then signer, initials, named deliverable, metadata, topics | [README](./law-firm-engagement/README.md) |
| [construction-change-orders](./construction-change-orders/) | Construction | Approver, two signers in sequence, prefilled text place, multiline text input | [README](./construction-change-orders/README.md) |
| [automotive](./automotive/) | Automotive | Sequential routing, initials, auto-filled name, email and date places | [README](./automotive/README.md) |
| [logistics-drivers](./logistics-drivers/) | Logistics | Inline ceremony with custom authentication, short URL for SMS, delivery_type none | [README](./logistics-drivers/README.md) |
| [marketplace-providers](./marketplace-providers/) | Marketplaces | Embedded ceremony via POST /v1/recipients/{id}/ceremonies, redirect URL, tenant metadata | [README](./marketplace-providers/README.md) |
| [fintech-account-opening](./fintech-account-opening/) | Fintech | Automatic signer countersignature, two-step authentication, deliverable, checkboxes | [README](./fintech-account-opening/README.md) |
| [public-sector](./public-sector/) | Public sector | Standard signer plus official approver, regex-validated input, qualified signature path explained | [README](./public-sector/README.md) |
| [telecom](./telecom/) | Telecommunications | Embedded ceremony via POST /v1/recipients/{id}/ceremonies, email code authentication, short URL | [README](./telecom/README.md) |

All data is synthetic. Documents point at the public sample files at `https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/`. See the [API reference](https://signatureapi.com/docs/api/resources/envelopes/create) and the [use-case guides](https://signatureapi.com/docs/use-cases/overview) for the full picture.
