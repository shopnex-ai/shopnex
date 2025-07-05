import type { ArrayField } from "payload";

export const OrderTimeline: ArrayField = {
    name: "timeline",
    type: "array",
    admin: {
        description:
            "Track important order events (e.g. status changes, payments, shipments, notes).",
    },
    fields: [
        {
            type: "row",
            fields: [
                {
                    name: "title",
                    type: "text",
                    label: "Event Title",
                    required: true,
                },
                {
                    name: "date",
                    type: "date",
                    defaultValue: () => new Date().toISOString(),
                    label: "Date",
                    required: true,
                },
            ],
        },
        {
            type: "row",
            fields: [
                {
                    name: "type",
                    type: "select",
                    label: "Event Type",
                    options: [
                        { label: "Note", value: "note" },
                        { label: "Order Created", value: "order_created" },
                        { label: "Order Paid", value: "order_paid" },
                        { label: "Order Cancelled", value: "order_cancelled" },
                        { label: "Refund Issued", value: "refund_issued" },
                        {
                            label: "Fulfillment Started",
                            value: "fulfillment_started",
                        },
                        { label: "Shipped", value: "shipped" },
                        { label: "Delivered", value: "delivered" },
                        {
                            label: "Return Requested",
                            value: "return_requested",
                        },
                        {
                            label: "Return Completed",
                            value: "return_completed",
                        },
                        { label: "Other", value: "other" },
                    ],
                    required: true,
                },
                {
                    name: "createdBy",
                    type: "relationship",
                    label: "Created By",
                    relationTo: "users", // adjust if your admin users collection is named differently
                },
            ],
        },
        {
            name: "details",
            type: "textarea",
            label: "Details / Notes",
        },
    ],
    label: "Order Timeline",
    labels: {
        plural: "Timeline Events",
        singular: "Timeline Event",
    },
};
