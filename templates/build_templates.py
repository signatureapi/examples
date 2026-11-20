"""Builds every DOCX template in this folder, with its sample data, envelope and README.

Run from anywhere: python3 -I build_templates.py
Needs python-docx (pip install python-docx). All text is fictional sample text for
Acme Corp, not legal advice.

Authoring rules this file follows (see the SignatureAPI template docs):
- Every {{field}} sits inside one run, so one run per paragraph.
- Names used inside {{if ...}} are camelCase or a single word, never snake_case.
- Place placeholders [[key]] are white text, so the signature place covers them.
- Blocks that must stay on one page are borderless one-row tables that cannot split.
- A repeating table references its array only in the data row.
"""

import json
import re
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

HERE = Path(__file__).resolve().parent
NOTE = "Sample text for demonstration. Not legal advice. Have a lawyer review any document before you use it."
DOCS_URL = "https://signatureapi.com/docs/api/resources/documents/templates"

ACME = {"name": "Acme Corp", "signatory": "Alex Chen", "signatoryTitle": "Head of Operations",
        "address": "100 Example Street, Springfield"}


class Builder:
    def __init__(self):
        self.doc = Document()
        st = self.doc.styles["Normal"]
        st.font.name = "Arial"
        st.font.size = Pt(10.5)

    def run(self, p, text, bold=False, italic=False, size=None):
        r = p.add_run(text)
        r.bold, r.italic = bold, italic
        if size:
            r.font.size = Pt(size)
        return r

    def para(self, text, bold=False, italic=False, size=None, align=None):
        p = self.doc.add_paragraph()
        self.run(p, text, bold, italic, size)
        if align:
            p.alignment = align
        return p

    def block(self, cols=1):
        table = self.doc.add_table(rows=1, cols=cols)
        mar = OxmlElement("w:tblCellMar")
        for side in ("top", "left", "bottom", "right"):
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:w"), "0")
            el.set(qn("w:type"), "dxa")
            mar.append(el)
        table._tbl.tblPr.append(mar)
        table.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))
        self.doc.add_paragraph()
        return table.rows[0].cells

    def cell(self, cell, text, first=False, **kw):
        p = cell.paragraphs[0] if first else cell.add_paragraph()
        self.run(p, text, **kw)
        return p

    def section(self, heading, *lines):
        (c,) = self.block()
        self.cell(c, heading, first=True, bold=True)
        for line in lines:
            self.cell(c, line)

    def conditional(self, heading, flag, yes, no):
        (c,) = self.block()
        self.cell(c, heading, first=True, bold=True)
        self.cell(c, "{{if %s}}" % flag)
        self.cell(c, yes)
        self.cell(c, "{{else}}")
        self.cell(c, no)
        self.cell(c, "{{endif}}")

    def table(self, headers, fields):
        t = self.doc.add_table(rows=2, cols=len(headers))
        t.style = "Table Grid"
        for i, h in enumerate(headers):
            self.run(t.rows[0].cells[i].paragraphs[0], h, bold=True)
        for i, f in enumerate(fields):
            self.run(t.rows[1].cells[i].paragraphs[0], f)
        self.doc.add_paragraph()

    def signatures(self, signers, date_line):
        """signers: list of (label, place_key, name_field). One unsplittable row."""
        cells = self.block(cols=len(signers))
        for i, (cell, (label, key, name)) in enumerate(zip(cells, signers)):
            self.cell(cell, date_line if i == 0 else "", first=True)
            self.cell(cell, "")
            self.cell(cell, label)
            p = self.cell(cell, "[[%s]]" % key)
            p.runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            p.paragraph_format.space_before = Pt(62)
            p.paragraph_format.space_after = Pt(18)
            self.cell(cell, name)


def build(spec):
    b = Builder()
    b.para(spec["title"], bold=True, size=16, align=WD_ALIGN_PARAGRAPH.CENTER)
    b.para(NOTE, italic=True, size=8, align=WD_ALIGN_PARAGRAPH.CENTER)
    for item in spec["body"]:
        kind = item[0]
        if kind == "p":
            b.para(item[1])
        elif kind == "s":
            b.section(item[1], *item[2:])
        elif kind == "if":
            b.conditional(*item[1:])
        elif kind == "table":
            b.table(item[1], item[2])
    b.signatures(spec["signers"], spec["dateLine"])
    return b.doc


def texts(doc):
    out = [p.text for p in doc.paragraphs]
    for t in doc.tables:
        for row in t.rows:
            for c in row.cells:
                out.extend(p.text for p in c.paragraphs)
    return out


def fields_of(doc):
    found = []
    for line in texts(doc):
        for m in re.findall(r"\{\{([^}]*)\}\}", line):
            if m.startswith(("if ", "else", "endif")):
                if m.startswith("if "):
                    found.append(m[3:].strip())
                continue
            if m not in found:
                found.append(m)
    seen, ordered = set(), []
    for f in found:
        if f not in seen:
            seen.add(f)
            ordered.append(f)
    return ordered


def sample_value(data, path):
    cur = data
    for i, part in enumerate(path.split(".")):
        if isinstance(cur, list):
            cur = cur[0]
            return "each item: " + sample_value({"x": cur}, "x." + ".".join(path.split(".")[i:]))
        cur = cur[part]
    return json.dumps(cur) if not isinstance(cur, str) else cur


def signer_obj(key, name, email, **extra):
    return {"type": "signer", "key": key, "name": name, "email": email, **extra}


JANE = ("Jane Doe", "jane.doe@example.com")
JOHN = ("John Smith", "john.smith@example.com")
MARIA = ("Maria Garcia", "maria.garcia@example.com")
ALEX = ("Alex Chen", "alex.chen@example.com")


def two_party(title, a_label, b_label, a_key="partyA", b_key="partyB"):
    return None


SPECS = [
 {
  "slug": "offer-letter", "title": "Offer Letter",
  "summary": "An offer of employment with a salary, a start date and an optional sign-on bonus.",
  "dateLine": "Date: {{offerDate}}",
  "body": [
   ("p", "{{employer.name}}"), ("p", "{{employer.address}}"),
   ("p", "Dear {{candidate.name}},"),
   ("p", "We are pleased to offer you the position of {{jobTitle}} in the {{department}} team at {{employer.name}}, reporting to {{manager}}."),
   ("s", "1. Start date", "Your employment is expected to begin on {{startDate}}."),
   ("s", "2. Compensation", "Your annual base salary is {{currency}} {{salary}}, paid in equal monthly instalments, less applicable withholdings."),
   ("if", "3. Sign-on bonus", "hasSignOnBonus", "You will receive a one-time sign-on bonus of {{currency}} {{signOnBonus}}, paid with your first salary.", "This offer does not include a sign-on bonus."),
   ("s", "4. Acceptance", "This offer is open until {{offerExpiry}}. Sign below to accept. Your employment is at will unless local law says otherwise."),
  ],
  "signers": [("Employer", "employer_signs_here", "{{employer.signatory}}, {{employer.signatoryTitle}}"), ("Candidate", "candidate_signs_here", "{{candidate.name}}")],
  "data": {"offerDate": "2026-11-02", "employer": ACME, "candidate": {"name": "Jane Doe"}, "jobTitle": "Product Designer", "department": "Design",
           "manager": "John Smith", "startDate": "2026-12-01", "currency": "USD", "salary": "85,000", "hasSignOnBonus": True,
           "signOnBonus": "3,000", "offerExpiry": "2026-11-16"},
  "recipients": [signer_obj("employer", *ALEX), signer_obj("candidate", *JANE)],
  "places": [("employer_signs_here", "employer"), ("candidate_signs_here", "candidate")],
  "docTitle": "Offer Letter (sample)",
 },
 {
  "slug": "mutual-nda", "title": "Mutual Non-Disclosure Agreement",
  "summary": "A mutual NDA between two companies with a term in years and a governing law.",
  "dateLine": "Effective date: {{effectiveDate}}",
  "body": [
   ("p", "This agreement is made between {{partyA.name}} of {{partyA.address}} and {{partyB.name}} of {{partyB.address}} (together, the parties)."),
   ("s", "1. Purpose", "The parties wish to discuss {{purpose}} and may share confidential information for that purpose only."),
   ("s", "2. Confidential information", "Confidential information is any non-public information one party shares with the other, in any form, that is marked confidential or would reasonably be understood to be."),
   ("s", "3. Obligations", "Each party will keep the other's confidential information secret, use it only for the purpose, and share it only with people who need it and are bound by similar duties."),
   ("s", "4. Term", "This agreement lasts for {{termYears}} years from the effective date. The duties in section 3 continue for {{survivalYears}} years after it ends."),
   ("s", "5. Governing law", "This agreement is governed by the laws of {{governingLaw}}."),
  ],
  "signers": [("Party A", "party_a_signs_here", "{{partyA.signatory}}, {{partyA.name}}"), ("Party B", "party_b_signs_here", "{{partyB.signatory}}, {{partyB.name}}")],
  "data": {"effectiveDate": "2026-11-02", "partyA": {**ACME, "name": "Acme Corp", "signatory": "Alex Chen"},
           "partyB": {"name": "Globex Example Ltd", "address": "5 Sample Road, Shelbyville", "signatory": "John Smith"},
           "purpose": "a possible software partnership", "termYears": "2", "survivalYears": "3", "governingLaw": "the State of Delaware"},
  "recipients": [signer_obj("party_a", *ALEX), signer_obj("party_b", *JOHN)],
  "places": [("party_a_signs_here", "party_a"), ("party_b_signs_here", "party_b")],
  "docTitle": "Mutual NDA (sample)",
 },
 {
  "slug": "employment-contract", "title": "Employment Contract",
  "summary": "A fixed-form employment contract with an optional probation period.",
  "dateLine": "{{city}}, {{contractDate}}",
  "body": [
   ("p", "between {{employer.name}}, {{employer.address}}, represented by {{employer.signatory}} (the Employer)"),
   ("p", "and {{employee.name}}, {{employee.address}} (the Employee)."),
   ("s", "1. Start and position", "Employment starts on {{startDate}}. The Employee is hired as {{jobTitle}}."),
   ("if", "2. Probation period", "hasProbation", "The first {{probationMonths}} months are a probation period. Either party may end the contract with two weeks' notice during probation.", "No probation period is agreed."),
   ("s", "3. Working hours", "Regular working time is {{weeklyHours}} hours per week."),
   ("s", "4. Salary", "The Employee receives a gross annual salary of {{currency}} {{salary}}, paid in twelve monthly instalments."),
   ("s", "5. Vacation", "The Employee is entitled to {{vacationDays}} working days of vacation per calendar year."),
   ("s", "6. Final provisions", "Changes to this contract must be made in writing. This contract is governed by the laws of {{governingLaw}}."),
  ],
  "signers": [("Employer", "employer_signs_here", "{{employer.signatory}}, {{employer.name}}"), ("Employee", "employee_signs_here", "{{employee.name}}")],
  "data": {"city": "Springfield", "contractDate": "2026-11-02", "employer": ACME,
           "employee": {"name": "Maria Garcia", "address": "12 Sample Lane, Springfield"}, "startDate": "2026-12-01",
           "jobTitle": "Customer Success Manager", "hasProbation": True, "probationMonths": "3", "weeklyHours": "40",
           "currency": "USD", "salary": "72,000", "vacationDays": "25", "governingLaw": "the State of Delaware"},
  "recipients": [signer_obj("employer", *ALEX), signer_obj("employee", *MARIA)],
  "places": [("employer_signs_here", "employer"), ("employee_signs_here", "employee")],
  "docTitle": "Employment Contract (sample)",
 },
 {
  "slug": "contractor-agreement", "title": "Independent Contractor Agreement",
  "summary": "An agreement for an independent contractor paid by the hour or by a fixed fee.",
  "dateLine": "Date: {{effectiveDate}}",
  "body": [
   ("p", "This agreement is between {{company.name}} (the Company) and {{contractor.name}} of {{contractor.address}} (the Contractor)."),
   ("s", "1. Services", "The Contractor will provide the following services: {{services}}."),
   ("if", "2. Fees", "isHourly", "The Company will pay {{currency}} {{hourlyRate}} per hour, invoiced monthly and payable within {{paymentDays}} days.", "The Company will pay a fixed fee of {{currency}} {{fixedFee}}, payable within {{paymentDays}} days of the final delivery."),
   ("s", "3. Independent status", "The Contractor is not an employee. The Contractor controls how the services are done and pays their own taxes and insurance."),
   ("s", "4. Ownership of work", "Work the Contractor creates for the Company under this agreement belongs to the Company once the Company has paid for it."),
   ("s", "5. Term and ending", "This agreement starts on the effective date and ends on {{endDate}}. Either party may end it earlier with {{noticeDays}} days' written notice."),
  ],
  "signers": [("Company", "company_signs_here", "{{company.signatory}}, {{company.name}}"), ("Contractor", "contractor_signs_here", "{{contractor.name}}")],
  "data": {"effectiveDate": "2026-11-02", "company": ACME, "contractor": {"name": "John Smith", "address": "8 Example Court, Capital City"},
           "services": "website design and front-end development", "isHourly": True, "hourlyRate": "95", "fixedFee": "12,000",
           "currency": "USD", "paymentDays": "30", "endDate": "2027-02-28", "noticeDays": "14"},
  "recipients": [signer_obj("company", *ALEX), signer_obj("contractor", *JOHN)],
  "places": [("company_signs_here", "company"), ("contractor_signs_here", "contractor")],
  "docTitle": "Independent Contractor Agreement (sample)",
 },
 {
  "slug": "master-services-agreement", "title": "Master Services Agreement",
  "summary": "A framework agreement that later statements of work refer to.",
  "dateLine": "Effective date: {{effectiveDate}}",
  "body": [
   ("p", "This master services agreement is between {{provider.name}} (the Provider) and {{client.name}} (the Client)."),
   ("s", "1. Services", "The Provider will perform the services described in each statement of work signed by both parties. Each statement of work is governed by this agreement."),
   ("s", "2. Fees and payment", "The Client pays the fees in each statement of work. Invoices are payable within {{paymentDays}} days. Late amounts bear interest at {{lateFeePercent}} percent per month."),
   ("s", "3. Confidentiality", "Each party keeps the other's non-public information confidential during the term and for {{confidentialityYears}} years afterwards."),
   ("s", "4. Liability", "Neither party is liable for indirect losses. Each party's total liability under a statement of work is limited to the fees paid under it in the previous twelve months."),
   ("s", "5. Term", "This agreement runs for {{termMonths}} months from the effective date and renews monthly until either party gives {{noticeDays}} days' written notice."),
   ("s", "6. Governing law", "This agreement is governed by the laws of {{governingLaw}}."),
  ],
  "signers": [("Provider", "provider_signs_here", "{{provider.signatory}}, {{provider.name}}"), ("Client", "client_signs_here", "{{client.signatory}}, {{client.name}}")],
  "data": {"effectiveDate": "2026-11-02", "provider": ACME, "client": {"name": "Globex Example Ltd", "signatory": "Jane Doe"},
           "paymentDays": "30", "lateFeePercent": "1", "confidentialityYears": "3", "termMonths": "12", "noticeDays": "60",
           "governingLaw": "the State of Delaware"},
  "recipients": [signer_obj("provider", *ALEX), signer_obj("client", *JANE)],
  "places": [("provider_signs_here", "provider"), ("client_signs_here", "client")],
  "docTitle": "Master Services Agreement (sample)",
 },
 {
  "slug": "statement-of-work", "title": "Statement of Work",
  "summary": "A statement of work with a dynamic table of line items that grows with your data.",
  "dateLine": "Date: {{sowDate}}",
  "body": [
   ("p", "This statement of work is issued under the master services agreement dated {{msaDate}} between {{provider.name}} and {{client.name}}."),
   ("s", "1. Project", "{{projectName}}: {{projectSummary}}"),
   ("p", "2. Deliverables and fees"),
   ("table", ["Item", "Quantity", "Unit price", "Amount"], ["{{lineItems.description}}", "{{lineItems.quantity}}", "{{lineItems.unitPrice}}", "{{lineItems.amount}}"]),
   ("s", "3. Total", "The total fee is {{currency}} {{total}}. It is invoiced as follows: {{billingTerms}}."),
   ("s", "4. Schedule", "Work starts on {{startDate}} and is planned to finish by {{endDate}}."),
  ],
  "signers": [("Provider", "provider_signs_here", "{{provider.signatory}}, {{provider.name}}"), ("Client", "client_signs_here", "{{client.signatory}}, {{client.name}}")],
  "data": {"sowDate": "2026-11-02", "msaDate": "2026-10-15", "provider": ACME, "client": {"name": "Globex Example Ltd", "signatory": "Jane Doe"},
           "projectName": "Customer portal", "projectSummary": "design and build a customer portal for order tracking",
           "lineItems": [{"description": "Discovery workshop", "quantity": "1", "unitPrice": "2,000", "amount": "2,000"},
                         {"description": "Interface design", "quantity": "40 hours", "unitPrice": "100", "amount": "4,000"},
                         {"description": "Front-end build", "quantity": "80 hours", "unitPrice": "110", "amount": "8,800"}],
           "currency": "USD", "total": "14,800", "billingTerms": "50 percent at the start and 50 percent on delivery",
           "startDate": "2026-12-01", "endDate": "2027-02-26"},
  "recipients": [signer_obj("provider", *ALEX), signer_obj("client", *JANE)],
  "places": [("provider_signs_here", "provider"), ("client_signs_here", "client")],
  "docTitle": "Statement of Work (sample)",
 },
 {
  "slug": "residential-lease", "title": "Residential Lease Agreement",
  "summary": "A fixed-term lease for a home with rent, a deposit and an optional pet clause.",
  "dateLine": "Date: {{leaseDate}}",
  "body": [
   ("p", "This lease is between {{landlord.name}} (the Landlord) and {{tenant.name}} (the Tenant) for the property at {{property.address}}."),
   ("s", "1. Term", "The lease starts on {{startDate}} and ends on {{endDate}}."),
   ("s", "2. Rent", "The Tenant pays {{currency}} {{monthlyRent}} per month, due on day {{dueDay}} of each month."),
   ("s", "3. Security deposit", "The Tenant pays a security deposit of {{currency}} {{deposit}}. The Landlord returns it within 30 days after the lease ends, less any lawful deductions."),
   ("if", "4. Pets", "petsAllowed", "The Tenant may keep one pet. The Tenant is responsible for any damage the pet causes.", "No pets are allowed in the property."),
   ("s", "5. Use and care", "The Tenant uses the property only as a home, keeps it clean and reports damage promptly."),
  ],
  "signers": [("Landlord", "landlord_signs_here", "{{landlord.name}}"), ("Tenant", "tenant_signs_here", "{{tenant.name}}")],
  "data": {"leaseDate": "2026-11-02", "landlord": {"name": "Alex Chen"}, "tenant": {"name": "Maria Garcia"},
           "property": {"address": "42 Sample Avenue, Apartment 3B, Springfield"}, "startDate": "2026-12-01", "endDate": "2027-11-30",
           "currency": "USD", "monthlyRent": "1,800", "dueDay": "1", "deposit": "1,800", "petsAllowed": False},
  "recipients": [signer_obj("landlord", *ALEX), signer_obj("tenant", *MARIA)],
  "places": [("landlord_signs_here", "landlord"), ("tenant_signs_here", "tenant")],
  "docTitle": "Residential Lease (sample)",
 },
 {
  "slug": "purchase-agreement", "title": "Purchase Agreement",
  "summary": "A simple agreement to sell and buy an item with a price, a deposit and a delivery date.",
  "dateLine": "Date: {{agreementDate}}",
  "body": [
   ("p", "{{seller.name}} (the Seller) agrees to sell and {{buyer.name}} (the Buyer) agrees to buy the item described below."),
   ("s", "1. Item", "{{itemDescription}}"),
   ("s", "2. Price", "The price is {{currency}} {{price}}. The Buyer pays a deposit of {{currency}} {{deposit}} on signing and the rest on delivery."),
   ("s", "3. Delivery", "The Seller delivers the item to {{deliveryAddress}} by {{deliveryDate}}."),
   ("if", "4. Warranty", "hasWarranty", "The Seller promises the item works as described for {{warrantyMonths}} months after delivery.", "The item is sold as is, without a warranty."),
   ("s", "5. Ownership", "Ownership passes to the Buyer when the Seller receives the full price."),
  ],
  "signers": [("Seller", "seller_signs_here", "{{seller.name}}"), ("Buyer", "buyer_signs_here", "{{buyer.name}}")],
  "data": {"agreementDate": "2026-11-02", "seller": {"name": "Acme Corp"}, "buyer": {"name": "John Smith"},
           "itemDescription": "One standing desk, model SD-200, in oak finish", "currency": "USD", "price": "650", "deposit": "100",
           "deliveryAddress": "8 Example Court, Capital City", "deliveryDate": "2026-12-10", "hasWarranty": True, "warrantyMonths": "12"},
  "recipients": [signer_obj("seller", *ALEX), signer_obj("buyer", *JOHN)],
  "places": [("seller_signs_here", "seller"), ("buyer_signs_here", "buyer")],
  "docTitle": "Purchase Agreement (sample)",
 },
 {
  "slug": "medical-consent", "title": "Consent to Treatment",
  "summary": "A general consent form for a routine visit. It holds no health data: describe the visit in general terms only.",
  "dateLine": "Date: {{consentDate}}",
  "body": [
   ("p", "Provider: {{clinic.name}}, {{clinic.address}}"),
   ("p", "Patient: {{patient.name}}"),
   ("s", "1. Consent", "I agree to receive the care described here from {{clinic.name}}: {{visitDescription}}."),
   ("s", "2. Explanation", "The care team explained what to expect and I had the chance to ask questions."),
   ("if", "3. Guardian", "isMinor", "I am the parent or legal guardian of the patient and I have the authority to give this consent.", "I am an adult and I give this consent for myself."),
   ("s", "4. Withdrawing consent", "I can withdraw this consent at any time by telling the care team."),
  ],
  "signers": [("Patient or guardian", "patient_signs_here", "{{patient.name}}")],
  "data": {"consentDate": "2026-11-02", "clinic": {"name": "Acme Wellness Clinic", "address": "7 Sample Plaza, Springfield"},
           "patient": {"name": "Jane Doe"}, "visitDescription": "a routine annual checkup", "isMinor": False},
  "recipients": [signer_obj("patient", *JANE)],
  "places": [("patient_signs_here", "patient")],
  "docTitle": "Consent to Treatment (sample)",
 },
 {
  "slug": "liability-waiver", "title": "Liability Waiver",
  "summary": "A waiver for a recreational activity with an optional equipment clause.",
  "dateLine": "Date: {{waiverDate}}",
  "body": [
   ("p", "Activity: {{activityName}} on {{activityDate}}, organized by {{organizer.name}} (the Organizer)."),
   ("p", "Participant: {{participant.name}}"),
   ("s", "1. Risks", "I understand that {{activityName}} has risks, including injury. I choose to take part."),
   ("s", "2. Release", "I release the Organizer and its staff from claims for injury or loss that arise from my taking part, except where the law does not allow a release."),
   ("if", "3. Equipment", "providesEquipment", "I will use the equipment the Organizer provides as instructed and report any damage.", "I will bring and take care of my own equipment."),
   ("s", "4. Health", "I confirm I am fit to take part and will tell the Organizer if that changes."),
  ],
  "signers": [("Participant", "participant_signs_here", "{{participant.name}}")],
  "data": {"waiverDate": "2026-11-02", "activityName": "the Saturday trail ride", "activityDate": "2026-11-14",
           "organizer": {"name": "Acme Outdoor Club"}, "participant": {"name": "John Smith"}, "providesEquipment": True},
  "recipients": [signer_obj("participant", *JOHN)],
  "places": [("participant_signs_here", "participant")],
  "docTitle": "Liability Waiver (sample)",
 },
 {
  "slug": "permission-slip", "title": "School Permission Slip",
  "summary": "A permission slip for a school trip, signed by a parent or guardian.",
  "dateLine": "Date: {{slipDate}}",
  "body": [
   ("p", "School: {{school.name}}"),
   ("p", "Trip: {{tripName}} on {{tripDate}}, leaving at {{departureTime}}."),
   ("s", "1. Permission", "I give permission for my child, {{student.name}} (grade {{student.grade}}), to go on this trip."),
   ("s", "2. Contact", "During the trip I can be reached at {{guardian.phone}}."),
   ("if", "3. Cost", "hasFee", "I will pay the trip fee of {{currency}} {{fee}} by {{feeDueDate}}.", "There is no fee for this trip."),
   ("s", "4. Return", "I understand my child must return the signed slip before {{returnDate}} to take part."),
  ],
  "signers": [("Parent or guardian", "guardian_signs_here", "{{guardian.name}}")],
  "data": {"slipDate": "2026-11-02", "school": {"name": "Springfield Example School"}, "tripName": "Science museum visit",
           "tripDate": "2026-11-20", "departureTime": "9:00", "student": {"name": "Sam Doe", "grade": "5"},
           "guardian": {"name": "Jane Doe", "phone": "555-0100"}, "hasFee": True, "currency": "USD", "fee": "12", "feeDueDate": "2026-11-13",
           "returnDate": "2026-11-16"},
  "recipients": [signer_obj("guardian", *JANE)],
  "places": [("guardian_signs_here", "guardian")],
  "docTitle": "School Permission Slip (sample)",
 },
 {
  "slug": "change-order", "title": "Change Order",
  "summary": "A change order that adds a table of changed items and the new total to an existing contract.",
  "dateLine": "Date: {{changeDate}}",
  "body": [
   ("p", "Change order {{changeNumber}} to the contract dated {{contractDate}} between {{contractor.name}} (the Contractor) and {{client.name}} (the Client)."),
   ("s", "1. Reason", "{{reason}}"),
   ("p", "2. Changes"),
   ("table", ["Change", "Cost impact"], ["{{changes.description}}", "{{changes.amount}}"]),
   ("s", "3. Totals", "Original contract price: {{currency}} {{originalPrice}}. This change order: {{currency}} {{changeTotal}}. New contract price: {{currency}} {{newPrice}}."),
   ("s", "4. Schedule", "This change moves the completion date by {{daysAdded}} days, to {{newCompletionDate}}."),
   ("s", "5. Other terms", "All other terms of the contract stay the same."),
  ],
  "signers": [("Contractor", "contractor_signs_here", "{{contractor.signatory}}, {{contractor.name}}"), ("Client", "client_signs_here", "{{client.name}}")],
  "data": {"changeDate": "2026-11-02", "changeNumber": "2", "contractDate": "2026-09-01", "contractor": ACME,
           "client": {"name": "Maria Garcia"}, "reason": "The Client asked for an extra storage room and a different flooring.",
           "changes": [{"description": "Add a storage room", "amount": "3,200"}, {"description": "Upgrade flooring to hardwood", "amount": "1,450"}],
           "currency": "USD", "originalPrice": "42,000", "changeTotal": "4,650", "newPrice": "46,650", "daysAdded": "10",
           "newCompletionDate": "2027-01-22"},
  "recipients": [signer_obj("contractor", *ALEX), signer_obj("client", *MARIA)],
  "places": [("contractor_signs_here", "contractor"), ("client_signs_here", "client")],
  "docTitle": "Change Order (sample)",
 },
]


def readme(spec, flds, data):
    rows = "\n".join("| `%s` | %s |" % (f, sample_value(data, f).replace("|", "/")) for f in flds)
    places = "\n".join("- `%s` for the recipient `%s`" % p for p in spec["places"])
    people = "\n".join("- `%s`: %s" % (r["key"], r["name"]) for r in spec["recipients"])
    slug = spec["slug"]
    return f"""# {spec['title']} DOCX template

{spec['summary']} Fictional text for Acme Corp, ready to merge and send in test mode.

> Not legal advice. This is sample text for demonstration. Have a lawyer review any document before you use it with real people.

## What is in this folder

- `template.docx`: the DOCX template with merge fields and signature placeholders.
- `sample-data.json`: example values for the `data` property of the document.
- `envelope.json`: the recipients and places for the envelope, with `title` and `message`.
- `../send-template.mjs`: a zero-dependency script that uploads the template and creates a test-mode envelope.

## Send it in test mode

You need Node.js 20 or newer and a SignatureAPI **test** API key (it starts with `key_test_`). Create one in the [dashboard](https://dashboard.signatureapi.com).

```bash
export SIGNATUREAPI_KEY=key_test_...
node ../send-template.mjs {slug}
```

Run it from this folder, or pass the path to the template folder. The script refuses any key that is not a test key and never prints the key.

## Merge fields

SignatureAPI merges the values in `data` into the template before signing. A field is written with double curly braces. Dots reach nested values, and `if` blocks show or hide a section. Details are in [Document Templates]({DOCS_URL}).

| Field | Sample value |
|---|---|
{rows}

## Places

The template has white-text placeholders in double brackets. Each one is replaced by a signature place when the envelope is processed.

{places}

Recipients in `envelope.json`:

{people}

## Make it yours

1. Open `template.docx` in Microsoft Word and change the text. Keep each field inside one run of text: type it in one go, without changing the formatting in the middle.
2. Keep names used inside `if` blocks in camelCase or a single word. Underscores in those names cause a template error.
3. Change the values in `sample-data.json`, or send your own `data` from code.
4. Save the file from Word. DOCX files from other editors may fail to parse.

The `build_templates.py` script one level up shows how these files are generated.

## Learn more

- [Document Templates]({DOCS_URL})
- [Place positioning](https://signatureapi.com/docs/api/resources/places/positioning)
"""


def main():
    index = []
    for spec in SPECS:
        d = HERE / spec["slug"]
        d.mkdir(exist_ok=True)
        doc = build(spec)
        doc.save(d / "template.docx")
        flds = fields_of(doc)
        (d / "sample-data.json").write_text(json.dumps(spec["data"], indent=2) + "\n")
        env = {
            "title": spec["docTitle"],
            "message": "Please review and sign. This is a sample in test mode.",
            "document": {"key": "main", "filename": "template.docx"},
            "recipients": spec["recipients"],
            "places": [{"key": k, "type": "signature", "recipient_key": r} for k, r in spec["places"]],
        }
        (d / "envelope.json").write_text(json.dumps(env, indent=2) + "\n")
        (d / "README.md").write_text(readme(spec, flds, spec["data"]))
        index.append((spec["slug"], spec["title"], spec["summary"]))
    lines = "\n".join("| [`%s/`](%s/) | %s | %s |" % (s, s, t, m) for s, t, m in index)
    (HERE / "README.md").write_text(f"""# DOCX templates

Twelve ready-to-send DOCX templates with merge fields, written as fictional text for Acme Corp. Each folder has the template, sample data, an envelope definition and a README.

> Not legal advice. The text is sample text for demonstration. Have a lawyer review any document before you use it with real people.

| Folder | Template | Summary |
|---|---|---|
{lines}

## Send one in test mode

```bash
export SIGNATUREAPI_KEY=key_test_...
node send-template.mjs offer-letter
```

`send-template.mjs` needs Node.js 20 or newer and no packages. It uploads `template.docx`, creates the envelope with the sample data and prints a summary. It works with test keys only.

## How templates work

A DOCX template holds fields written with double curly braces, plus optional `if` blocks and repeating tables. You send values in the `data` property of the document, and SignatureAPI produces the final document. Signature places are positioned with white-text placeholders in double brackets. See [Document Templates]({DOCS_URL}).

## Regenerate

`python3 -I build_templates.py` rebuilds every folder. It needs `python-docx`.
""")


if __name__ == "__main__":
    main()
