frappe.ui.form.on("Sales Invoice", {
    refresh(frm) {
        if (frm.doc.docstatus === 1) {
            const add_payment_button = (label, callback) => {
                frm.add_custom_button(label, callback, __("Payment"));
            };
            add_payment_button("Quick Payment", () => {
                show_quick_payment_dialog(frm);
            });
            add_payment_button("Show Payments", () => {
                show_payments_dialog(frm);
            });
        }
    }
});

function show_quick_payment_dialog(frm) {
    const fields = [
        {
            label: __("Mode of Payment"),
            fieldname: 'mode_of_payment',
            fieldtype: 'Link',
            options: 'Mode of Payment',
            reqd: 1,
            onchange: function() {
                const mode_of_payment = this.get_value();
                
                const cheque_ref_field = dialog.get_field('cheque_ref_number');
                const cheque_date_field = dialog.get_field('cheque_ref_date');

                if (mode_of_payment) {
                    frappe.db.get_value('Mode of Payment', mode_of_payment, 'type', (r) => {
                        const payment_type = r.type;
                        
                        const show_bank_fields = (payment_type === 'Bank'); 

                        cheque_ref_field.toggle(show_bank_fields);
                        cheque_date_field.toggle(show_bank_fields);

                        if (show_bank_fields) {
                            cheque_ref_field.set_mandatory(1);
                            cheque_date_field.set_mandatory(1);
                        } else {
                            cheque_ref_field.set_mandatory(0);
                            cheque_date_field.set_mandatory(0);
                            cheque_ref_field.set_value(null);
                            cheque_date_field.set_value(null);
                        }
                    });
                } else {
                    cheque_ref_field.set_mandatory(0);
                    cheque_ref_field.toggle(false);
                    cheque_date_field.set_mandatory(0);
                    cheque_date_field.toggle(false);
                }
            }
        },
        {
            label: __("Amount"),
            fieldname: 'amount',
            fieldtype: 'Currency',
            options: frm.doc.currency,
            default: frm.doc.outstanding_amount,
            reqd: 1
        },
        {
            label: __("Cheque/Ref Number"),
            fieldname: 'cheque_ref_number',
            fieldtype: 'Data',
            hidden: 1
        },
        {
            label: __("Cheque/Ref Date"),
            fieldname: 'cheque_ref_date',
            fieldtype: 'Date',
            hidden: 1
        }
    ];

    const dialog = new frappe.ui.Dialog({
        title: __("Quick Payment for {0}", [frm.doc.name]),
        fields: fields,
        primary_action_label: __("Submit Payment"),
        primary_action: function(data) {
            frappe.call({
                method: 'stitch_production.api.quick_payment',
                args: {
                    doctype_type: "Sales Invoice",
                    invoice_name: frm.doc.name,
                    payment_data: data
                },
                freeze: true,
                freeze_message: __('Creating Payment Entry...'),

                callback: function(r) {
                    frappe.dom.unfreeze();
                    if (r.message && r.message.payment_entry_name) {
                        frappe.show_alert({
                            message: r.message.message,
                            indicator: 'green'
                        });
                        frm.refresh();
                        
                        frappe.set_route('Form', 'Payment Entry', r.message.payment_entry_name);
                        
                    } else if (r.message && r.message.message) {
                         frappe.show_alert({
                            message: r.message.message,
                            indicator: 'green'
                        });
                        frm.refresh();
                    }
                },
                error: function(r) {
                    frappe.dom.unfreeze();
                    frappe.msgprint({
                        title: __('Payment Error'),
                        indicator: 'red',
                        message: r.exc || __('An unknown error occurred while submitting payment.')
                    });
                }
            });
            dialog.hide();
        }
    });

    dialog.show();
}

function show_payments_dialog(frm) {
    frappe.call({
        method: "stitch_production.api.fetch_payments",
        args: {
            doctype_type: "Sales Invoice",
            doc: frm.doc.name
        },
        freeze: true,
        freeze_message: __("Fetching Payments...")
    }).then(res => {
        const data = res.message || [];

        let html = `
            <table class="table table-bordered table-sm">
                <thead>
                    <tr>
                        <th>Payment Entry</th>
                        <th>Posting Date</th>
                        <th>Paid Amount</th>
                        <th>Mode of Payment</th>
                        <th>Allocated</th>
                        <th>Cheque/Ref No</th>
                        <th>Cheque Date</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (!data.length) {
            html += `<tr><td colspan="8" class="text-center text-muted">No Payments Found</td></tr>`;
        } else {
            data.forEach(p => {
                html += `
                    <tr>
                        <td style="font-weight: bold;">
                            <a href="/app/payment-entry/${p.payment_entry}" target="_blank">
                                ${p.payment_entry}
                            </a>
                        </td>
                        <td>${p.creation.slice(0, -7) || ""}</td>
                        <td style="font-weight: bold; color: green;">${format_currency(p.paid_amount || 0, frm.doc.currency)}</td>
                        <td>${p.mode_of_payment || ""}</td>
                        <td>${format_currency(p.allocated_amount || 0, frm.doc.currency)}</td>
                        <td>${p.cheque_no || ""}</td>
                        <td>${p.cheque_date || ""}</td>
                    </tr>
                `;
            });
        }

        html += `</tbody></table>`;

        let d = new frappe.ui.Dialog({
            title: __("Payments for " + frm.doc.name),
            size: "extra-large",
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "payments_html"
                }
            ]
        });

        d.set_value("payments_html", html);
        d.show();
    });
}
