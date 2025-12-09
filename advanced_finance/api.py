import frappe
from frappe import _
import json



@frappe.whitelist()
def quick_payment(doctype_type,invoice_name, payment_data):

    if isinstance(payment_data, str):
        payment_data = json.loads(payment_data)

    amount = payment_data.get("amount")
    if not amount or float(amount) <= 0:
        frappe.throw("Amount cannot be zero or negative")

    si = frappe.get_doc(doctype_type, invoice_name)

    mop = frappe.get_doc("Mode of Payment", payment_data.get("mode_of_payment"))

    company_account = next(
        (acc for acc in mop.accounts if acc.company == si.company), None
    )
    company = frappe.get_doc("Company",si.company)

    if not company_account:
        frappe.throw(f"No account for Mode Of Payment {mop.name} in company {si.company}")

    paid_from = si.debit_to
    paid_to = company_account.default_account

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Receive"
    pe.company = si.company
    pe.posting_date = frappe.utils.today()

    pe.party_type = "Customer"
    pe.party = si.customer
    pe.party_name = si.customer_name

    pe.mode_of_payment = mop.name

    pe.paid_from = paid_from
    pe.paid_to = paid_to

    pe.paid_from_account_currency = company.default_currency
    pe.paid_to_account_currency = company.default_currency

    pe.paid_amount = amount
    pe.received_amount = amount

    if payment_data.get("cheque_ref_number"):
        pe.reference_no  = payment_data.get("cheque_ref_number")
        pe.reference_date  = payment_data.get("cheque_ref_date")

    # CHILD TABLEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE
    ref = pe.append("references", {})
    ref.reference_doctype = doctype_type
    ref.reference_name = si.name
    ref.due_date = si.due_date
    ref.total_amount = si.grand_total
    ref.outstanding_amount = si.outstanding_amount
    ref.allocated_amount = amount

    pe.insert(ignore_permissions=True)
    pe.submit()

    return {
        "message": f"Payment of {amount} submitted against {si.name}",
        "payment_entry_name": pe.name
    }


@frappe.whitelist()
def fetch_payments(doctype_type, doc):
    invoice_name = doc

    payment_refs = frappe.db.sql("""
        SELECT 
            per.parent AS payment_entry,
            pe.posting_date,
            pe.mode_of_payment,
            pe.paid_amount,
            per.allocated_amount,
            per.outstanding_amount,
            pe.reference_no AS cheque_no,
            pe.reference_date AS cheque_date,
            pe.creation AS creation
        FROM `tabPayment Entry Reference` per
        JOIN `tabPayment Entry` pe ON per.parent = pe.name
        WHERE per.reference_doctype = %s
        AND per.reference_name = %s
        AND pe.docstatus = 1
        ORDER BY pe.creation ASC
    """, (doctype_type, invoice_name), as_dict=True)

    return payment_refs
