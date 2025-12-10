frappe.ui.form.on('Mode of Payment', {
    refresh(frm) {
        if (frm.doc.type === "Cash") {
            frm.add_custom_button(
                __("Open Cash Register"),
                () => open_cash_register(frm),
                __("Cash Register")
            );
            frm.add_custom_button(
                __("Close Cash Register"),
                () => close_cash_register(frm),
                __("Cash Register")
            );
            frm.add_custom_button(
                __("Check Out"),
                () => check_out(frm),
                __("Cash Register")
            );
        }
    }
});

function open_cash_register(frm) {

    const dialog = new frappe.ui.Dialog({
        title: __("Open Cash Register"),
        fields: [
            {
                label: __("Cash Register"),
                fieldname: 'mode_of_payment',
                fieldtype: 'Link',
                options: 'Mode of Payment',
                default: frm.doc.name,
                read_only: 1,
            },
            {
                label: __("Date"),
                fieldname: 'opening_date',
                fieldtype: 'Datetime',
                default: frappe.datetime.now_datetime(),
                reqd: 1
            },
            {
                label: __("Opened By"),
                fieldname: 'opened_by',
                fieldtype: 'Link',
                options: 'User',
                default: frappe.session.user,
                reqd: 1
            },
            {
                label: __("Opening Amount"),
                fieldname: 'amount',
                fieldtype: 'Currency',
                reqd: 1
            }
        ],
        primary_action_label: __("Open"),
        primary_action: function(data) {

            frappe.call({
                method: "advanced_finance.api.create_cash_register_session",
                args: {
                    date: data.opening_date,
                    opened_by: data.opened_by,
                    amount: data.amount,
                    mode_of_payment: data.mode_of_payment
                },
                freeze: true,
                freeze_message: __('Opening Cash Register...'),
                callback: function(r) {
                    if (!r.exc) {
                        frappe.msgprint("Cash Register Opened.");
                        dialog.hide();
                    }
                }
            });
        }
    });

    dialog.show();
}

// function close_cash_register(frm) {

//     frappe.prompt(
//         [
//             {
//                 label: __("Opening Session"),
//                 fieldname: "opening",
//                 fieldtype: "Link",
//                 options: "Cash Register Opening",
//                 reqd: 1,
//                 get_query: () => {
//                     return {
//                         filters: {
//                             is_closed: 0,
//                             cash_register: frm.doc.name
//                         }
//                     };
//                 }
//             }
//         ],
//         function(values) {

//             const opening = values.opening;

//             frappe.call({
//                 method: "advanced_finance.api.get_opening_transactions",
//                 args: { opening: opening },
//                 freeze: true,
//                 freeze_message: __("Loading transactions..."),
//                 callback: function(r) {

//                     let data = r.message || {};
//                     let transactions = data.transactions || [];

//                     // Build HTML table string
//                     let transactions_html = `
//                         <table class="table table-bordered">
//                             <thead>
//                                 <tr>
//                                     <th>Payment Entry</th>
//                                     <th>Amount</th>
//                                     <th>Party</th>
//                                 </tr>
//                             </thead>
//                             <tbody>
//                                 ${transactions.map(t => `
//                                     <tr>
//                                         <td> 
//                                             <a href="/app/payment-entry/${t.name}">${t.name}</a>
//                                         </td>
//                                         <td>${frappe.format(t.paid_amount, {fieldtype: 'Currency'})}</td>
//                                         <td>${t.party || ''}</td>
//                                     </tr>
//                                 `).join('')}
//                             </tbody>
//                         </table>
//                     `;

//                     let dialog = new frappe.ui.Dialog({
//                         title: __("Close Cash Register"),
//                         size: "extra-large",
//                         fields: [
//                             {
//                                 fieldtype: "Data",
//                                 label: "Opening Session",
//                                 fieldname: "opening",
//                                 read_only: 1,
//                                 default: opening
//                             },
//                             {
//                                 fieldtype: "Currency",
//                                 label: "Opening Amount",
//                                 fieldname: "opening_amount",
//                                 read_only: 1,
//                                 default: data.opening_amount
//                             },
//                             {
//                                 fieldtype: "Currency",
//                                 label: "Expected Amount",
//                                 fieldname: "expected_amount",
//                                 read_only: 1,
//                                 default: data.expected_amount
//                             },
//                             {
//                                 fieldtype: "HTML",
//                                 fieldname: "transactions_html",
//                                 options: transactions_html
//                             },
//                             {
//                                 fieldtype: "Datetime",
//                                 label: __("Closing Date"),
//                                 fieldname: "closing_date",
//                                 default: frappe.datetime.now_datetime(),
//                                 reqd: 1
//                             },
//                             {
//                                 fieldtype: "Currency",
//                                 label: __("Collected Amount"),
//                                 fieldname: "collected_amount",
//                                 reqd: 1
//                             }
//                         ],
//                         primary_action_label: __("Close"),
//                         primary_action(data2) {

//                             frappe.call({
//                                 method: "advanced_finance.api.close_cash_register_session",
//                                 args: {
//                                     date: data2.closing_date,
//                                     opening: opening,
//                                     amount: data2.collected_amount
//                                 },
//                                 freeze: true,
//                                 freeze_message: __("Closing Cash Register..."),
//                                 callback: function(res) {
//                                     if (!res.exc) {
//                                         frappe.msgprint(`Cash Register Closed: ${res.message.closing}`);
//                                         dialog.hide();
//                                         frm.reload_doc();
//                                     }
//                                 }
//                             });
//                         }
//                     });

//                     dialog.show();
//                 }
//             });

//         },
//         __("Select Opening Session")
//     );
// }


function close_cash_register(frm) {

    frappe.prompt([
        {
            label: __("Opening Session"),
            fieldname: "opening",
            fieldtype: "Link",
            options: "Cash Register Opening",
            reqd: 1,
            get_query: () => {
                return {
                    filters: { is_closed: 0, cash_register: frm.doc.name }
                };
            }
        }
    ],
    function(values) {

        const opening = values.opening;

        frappe.call({
            method: "advanced_finance.api.get_opening_transactions",
            args: { opening: opening },
            freeze: true,
            freeze_message: __("Loading transactions..."),
            callback: function(r) {

                let data = r.message || {};
                let transactions = data.transactions || [];

                // Build HTML table string
                let transactions_html = `
                    <div style="max-height: 300px; overflow-y: auto;">
                    <table class="table table-bordered table-striped">
                        <thead>
                            <tr>
                                <th>Payment Entry</th>
                                <th>Amount</th>
                                <th>Party</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${transactions.map(t => `
                                <tr style="background-color: ${
                                    t.status === 'IN' ? '#d4f8d4' : '#ffd6d6'
                                };">
                                    <td><a href="/app/payment-entry/${t.name}" target="_blank">${t.name}</a></td>
                                    <td>${frappe.format(t.paid_amount, {fieldtype: 'Currency'})}</td>
                                    <td>${t.party || ''}</td>
                                    <td style="font-weight: bold; color: ${t.status === 'IN' ? 'green' : 'red'};">
                                        ${t.status}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>


                    </table>
                    </div>
                `;

                let dialog = new frappe.ui.Dialog({
                    title: __("Close Cash Register"),
                    size: "extra-large",
                    fields: [
                        { fieldtype: "Data", label: "Opening Session", fieldname: "opening", read_only: 1, default: opening },
                        { fieldtype: "Currency", label: "Opening Amount", fieldname: "opening_amount", read_only: 1, default: data.opening_amount },
                        { fieldtype: "Currency", label: "Expected Amount", fieldname: "expected_amount", read_only: 1, default: data.expected_amount },
                        { fieldtype: "HTML", fieldname: "transactions_html", options: transactions_html },
                        { fieldtype: "Datetime", label: __("Closing Date"), fieldname: "closing_date", default: frappe.datetime.now_datetime(), reqd: 1 },
                        { fieldtype: "Currency", label: __("Collected Amount"), fieldname: "collected_amount", reqd: 1 }
                    ],
                    primary_action_label: __("Close"),
                    primary_action(data2) {

                        frappe.call({
                            method: "advanced_finance.api.close_cash_register_session",
                            args: {
                                date: data2.closing_date,
                                opening: opening,
                                amount: data2.collected_amount
                            },
                            freeze: true,
                            freeze_message: __("Closing Cash Register..."),
                            callback: function(res) {
                                if (!res.exc) {
                                    frappe.msgprint(`Cash Register Closed: ${res.message.closing}`);
                                    dialog.hide();
                                    frm.reload_doc();
                                }
                            }
                        });
                    }
                });

                dialog.show();
            }
        });

    }, __("Select Opening Session"));
}


function check_out(frm) {
    
    frappe.prompt([
        {
            label: __("Select OPEN Cash Register Session"),
            fieldname: "opening",
            fieldtype: "Link",
            options: "Cash Register Opening",
            reqd: 1,
            get_query: () => {
                return {
                    filters: { is_closed: 0, cash_register: frm.doc.name }
                };
            }
        }
    ],
    function(values) {
        const opening_session = values.opening;

        const transfer_dialog = new frappe.ui.Dialog({
            title: __("Cash Register Check Out (Internal Transfer)"),
            fields: [
                {
                    label: __("Sender Session"),
                    fieldname: 'opening',
                    fieldtype: 'Data',
                    default: opening_session,
                    read_only: 1,
                    reqd: 1
                },
                {
                    label: __("Sender Cash Register"),
                    fieldname: 'sender_cash_register',
                    fieldtype: 'Link',
                    options: 'Mode of Payment',
                    default: frm.doc.name,
                    read_only: 1,
                    reqd: 1
                },
                {
                    label: __("Receiver Cash Register"),
                    fieldname: 'receiver_cash_register',
                    fieldtype: 'Link',
                    options: 'Mode of Payment',
                    get_query: () => {
                        return {
                            filters: { type: 'Cash', name: ['!=', frm.doc.name] }
                        };
                    },
                    reqd: 1
                },
                {
                    label: __("Amount to Send"),
                    fieldname: 'amount',
                    fieldtype: 'Currency',
                    reqd: 1,
                    description: __("The amount of cash to be transferred out of this register.")
                }
            ],
            primary_action_label: __("Transfer Cash"),
            primary_action: function(data) {
                frappe.call({
                    method: "advanced_finance.api.check_out",
                    args: {
                        opening: data.opening,
                        sender_cash_register: data.sender_cash_register,
                        receiver_cash_register: data.receiver_cash_register,
                        amount: data.amount
                    },
                    freeze: true,
                    freeze_message: __('Processing Cash Out...'),
                    callback: function(r) {
                        if (!r.exc) {
                            frappe.msgprint({
                                title: __('Success'),
                                message: __(`Cash transfer **{0}** sent from **{1}** to **{2}**. It will be counted in the receiver's next closing session.`, [r.message.name, data.sender_cash_register, data.receiver_cash_register]),
                                indicator: 'green'
                            });
                            transfer_dialog.hide();
                            frm.reload_doc();
                        }
                    }
                });
            }
        });

        transfer_dialog.show();
    }, 
    __("Select Session for Check Out")
    );
}

