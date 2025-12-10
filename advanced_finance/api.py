import frappe
from frappe import _
import json
from frappe.utils import flt, now

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



@frappe.whitelist()
def create_cash_register_session(date, opened_by, amount, mode_of_payment):

    amount = flt(amount)

    already_open = frappe.db.exists(
        "Cash Register Opening",
        {
            "is_closed": 0,
            "cash_register": mode_of_payment
        }
    )

    if already_open:
        frappe.throw("There is already an OPEN cash register session.")

    if amount < 0:
        frappe.throw("Amount must be greater than 0")

    mop = frappe.get_doc("Mode of Payment", mode_of_payment)
    if mop.type != "Cash":
        frappe.throw("Mode of Payment must be Cash")

    doc = frappe.get_doc({
        "doctype": "Cash Register Opening",
        "is_closed": 0,
        "opening_date": date,
        "opened_by": opened_by,
        "amount": amount,
        "cash_register": mode_of_payment
    })

    doc.insert(ignore_permissions=True)
    doc.submit()

    return {"name": doc.name}

@frappe.whitelist()
def get_opening_transactions(opening):
    if not opening:
        frappe.throw("Opening session is required")

    opening_doc = frappe.get_doc("Cash Register Opening", opening)
    current_register = opening_doc.cash_register

    # ---- SALES PAYMENTS (IN) ----
    sales_payments = frappe.get_all(
        "Payment Entry",
        filters={
            "custom_cash_register_opening": opening,
            "custom_is_closed": 0,
            "payment_type": ("!=", "Internal Transfer")
        },
        fields=["name", "paid_amount", "party", "payment_type"]
    )

    for t in sales_payments:
        t.status = "IN"
        t.paid_amount = float(t.paid_amount or 0)

    # ---- CASH OUT TRANSFERS (OUT) ----
    cash_out_transfers = frappe.get_all(
        "Payment Entry",
        filters={
            "custom_cash_register_opening": opening,
            "payment_type": "Internal Transfer",
            "mode_of_payment": current_register,
            "custom_sender_closed": 0
        },
        fields=["name", "paid_amount", "party", "payment_type"]
    )

    for t in cash_out_transfers:
        t.status = "OUT"
        t.paid_amount = float(t.paid_amount or 0)

    # ---- RECEIVED TRANSFERS (IN) ----
    received_transfers = frappe.get_all(
        "Payment Entry",
        filters={
            "payment_type": "Internal Transfer",
            "custom_receiver_cash_register": current_register,
            "custom_receiver_closed": 0
        },
        fields=["name", "received_amount as paid_amount", "party", "payment_type"]
    )

    for t in received_transfers:
        t.status = "IN"
        t.paid_amount = float(t.paid_amount or 0)

    # ---- Combine them ----
    all_transactions = sales_payments + cash_out_transfers + received_transfers

    # ---- Totals ----
    total_cash_in = (
        sum(t.paid_amount for t in sales_payments) +
        sum(t.paid_amount for t in received_transfers)
    )

    total_cash_out = sum(t.paid_amount for t in cash_out_transfers)

    net_cash_movement = total_cash_in - total_cash_out

    expected_amount = float(opening_doc.amount or 0) + net_cash_movement

    return {
        "transactions": all_transactions,
        "opening_amount": opening_doc.amount,
        "expected_amount": expected_amount
    }


@frappe.whitelist()
def close_cash_register_session(date, opening, amount):
    try:
        amount = flt(amount)
    except:
        frappe.throw("Amount must be a number")

    opening_doc = frappe.get_doc("Cash Register Opening", opening)

    if opening_doc.is_closed:
        frappe.throw(f"Session {opening} is already CLOSED.")

    current_register = opening_doc.cash_register

    sales_payments = frappe.get_all(
        "Payment Entry",
        filters={
            "custom_cash_register_opening": opening,
            "payment_type": ("!=", "Internal Transfer"),
            "custom_is_closed": 0
        },
        fields=["name", "paid_amount", "party"]
    )
    sales_total = sum([t.paid_amount for t in sales_payments])

    sender_transfers = frappe.get_all(
        "Payment Entry",
        filters={
            "custom_cash_register_opening": opening,
            "payment_type": "Internal Transfer",
            "mode_of_payment": current_register,
            "custom_sender_closed": 0
        },
        fields=["name", "paid_amount"]
    )
    sender_total = sum([t.paid_amount for t in sender_transfers])

    receiver_transfers = frappe.get_all(
        "Payment Entry",
        filters={
            "payment_type": "Internal Transfer",
            "custom_receiver_cash_register": current_register,
            "custom_receiver_closed": 0
        },
        fields=["name", "received_amount as paid_amount"]
    )
    receiver_total = sum([t.paid_amount for t in receiver_transfers])

    expected_amount = (
        opening_doc.amount
        + sales_total
        + receiver_total
        - sender_total
    )

    shortage = amount - expected_amount

    default_company_name = frappe.defaults.get_user_default("Company")
    company_doc = frappe.get_doc("Company", default_company_name)
    destination_account = company_doc.custom_cash_closing_variance_account

    closing_doc = frappe.get_doc({
        "doctype": "Cash Register Closing",
        "date": date,
        "opening": opening,
        "cash_register_transactions": [

            {
                "payment_entry": t.name,
                "amount": t.paid_amount,
                "party": t.party,
                "status": "IN"
            }
            for t in sales_payments
        ] + [

            {
                "payment_entry": t.name,
                "amount": t.paid_amount,
                "party": "",
                "status": "IN"
            }
            for t in receiver_transfers
        ] + [

            {
                "payment_entry": t.name,
                "amount": -t.paid_amount,
                "party": "",
                "status": "OUT"
            }
            for t in sender_transfers
        ],

        "expected_amount": expected_amount,
        "collected_amount": amount,
        "shortage": shortage,
        "destination_account": destination_account
    })

    closing_doc.insert(ignore_permissions=True)
    closing_doc.submit()

    for t in sales_payments:
        frappe.db.set_value("Payment Entry", t.name, "custom_is_closed", 1)

    for t in sender_transfers:
        frappe.db.set_value("Payment Entry", t.name, "custom_sender_closed", 1)

    for t in receiver_transfers:
        frappe.db.set_value("Payment Entry", t.name, "custom_receiver_closed", 1)

    internal_entries = frappe.get_all(
        "Payment Entry",
        filters={"payment_type": "Internal Transfer"},
        fields=["name", "custom_sender_closed", "custom_receiver_closed"]
    )
    for e in internal_entries:
        if e.custom_sender_closed == 1 and e.custom_receiver_closed == 1:
            frappe.db.set_value("Payment Entry", e.name, "custom_is_closed", 1)

    mode_of_payment = current_register
    accounts = frappe.get_all(
        "Mode of Payment Account",
        filters={"parent": mode_of_payment, "company": default_company_name},
        fields=["default_account"]
    )

    cash_account = accounts[0].default_account

    pe = frappe.get_doc({
        "doctype": "Payment Entry",
        "payment_type": "Internal Transfer",
        "paid_from": cash_account,
        "paid_to": destination_account,
        "paid_amount": expected_amount,
        "received_amount": amount,
        "posting_date": now(),
        "custom_cash_register_opening": opening,
        "custom_is_closed": 1,
        "company": default_company_name
    })
    pe.insert(ignore_permissions=True)
    pe.submit()

    opening_doc.db_set("is_closed", 1)
    opening_doc.db_set("closing", closing_doc.name)

    return {
        "closing": closing_doc.name,
        "expected": expected_amount,
        "shortage": shortage
    }

@frappe.whitelist()
def check_out(opening, sender_cash_register, receiver_cash_register, amount):
    try:
        amount = flt(amount)
    except:
        frappe.throw("Amount must be a number")
    
    sender = frappe.get_doc("Mode of Payment", sender_cash_register)
    
    default_company_name = frappe.defaults.get_user_default("Company")
    if not default_company_name:
        frappe.throw("Please set a default Company for your user.")
        
    sender_account = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": sender.name, "company": default_company_name},
        "default_account"
    )

    receiver_account = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": receiver_cash_register, "company": default_company_name},
        "default_account"
    )

    if not sender_account or not receiver_account:
        frappe.throw(_("Missing default account for one of the Mode of Payments."))

    itpe = frappe.get_doc({
        "doctype": "Payment Entry",
        "payment_type": "Internal Transfer",
        "paid_from": sender_account,
        "paid_to": receiver_account,
        "paid_amount": amount,
        "received_amount": amount,
        "posting_date": now(),

        "mode_of_payment": sender_cash_register,
        "custom_cash_register_opening": opening,
        "custom_receiver_cash_register": receiver_cash_register,

        "custom_is_closed": 0,
        "custom_sender_closed": 0,
        "custom_receiver_closed": 0,

        "company": default_company_name
    })
    
    itpe.insert(ignore_permissions=True)
    itpe.submit()

    return {"name": itpe.name}




def fill_opening(doc, method=None):
    if doc.payment_type == "Internal Transfer":
        return
    mode_of_payment = doc.mode_of_payment
    if not mode_of_payment:
        return
    mop_type = frappe.db.get_value("Mode of Payment", mode_of_payment, "type")
    if mop_type and mop_type != "Cash":
        return
    open_sessions = frappe.get_all(
        "Cash Register Opening",
        filters={
            "is_closed": 0,
            "cash_register": mode_of_payment
        },
        fields=["name"]
    )

    if open_sessions:
        doc.custom_cash_register_opening = open_sessions[0].name
    
    else:
        frappe.throw(
            _("Cannot create Payment Entry: No OPEN Cash Register session found for Mode of Payment **{0}**.").format(mode_of_payment)
        )

