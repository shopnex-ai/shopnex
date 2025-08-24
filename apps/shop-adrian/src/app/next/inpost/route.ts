import { getPayload } from "payload";

import config from "@payload-config";

type ParcelStatus =
  | "created"
  | "offers_prepared"
  | "offer_selected"
  | "confirmed"
  | "dispatched_by_sender"
  | "collected_from_sender"
  | "taken_by_courier"
  | "adopted_at_source_branch"
  | "sent_from_source_branch"
  | "ready_to_pickup_from_pok"
  | "ready_to_pickup_from_pok_registered"
  | "oversized"
  | "adopted_at_sorting_center"
  | "sent_from_sorting_center"
  | "adopted_at_target_branch"
  | "out_for_delivery"
  | "ready_to_pickup"
  | "pickup_reminder_sent"
  | "delivered"
  | "pickup_time_expired"
  | "avizo"
  | "claimed"
  | "returned_to_sender"
  | "canceled"
  | "other"
  | "dispatched_by_sender_to_pok"
  | "out_for_delivery_to_address"
  | "pickup_reminder_sent_address"
  | "rejected_by_receiver"
  | "undelivered_wrong_address"
  | "undelivered_incomplete_address"
  | "undelivered_unknown_receiver"
  | "undelivered_cod_cash_receiver"
  | "taken_by_courier_from_pok"
  | "undelivered"
  | "return_pickup_confirmation_to_sender"
  | "ready_to_pickup_from_branch"
  | "delay_in_delivery"
  | "redirect_to_box"
  | "canceled_redirect_to_box"
  | "readdressed"
  | "undelivered_no_mailbox"
  | "undelivered_not_live_address"
  | "undelivered_lack_of_access_letterbox"
  | "missing"
  | "stack_in_customer_service_point"
  | "stack_parcel_pickup_time_expired"
  | "unstack_from_customer_service_point"
  | "courier_avizo_in_customer_service_point"
  | "taken_by_courier_from_customer_service_point"
  | "stack_in_box_machine"
  | "unstack_from_box_machine"
  | "stack_parcel_in_box_machine_pickup_time_expired";

type InpostWebhookRequest = {
  event_ts: string;
  event: "shipment_status_changed" | "shipment_confirmed";
  organization_id: number;
  payload: {
    shipment_id: number;
    status: ParcelStatus;
    tracking_number: string;
  };
};

export async function POST(req: Request) {
  try {
    const payload = await getPayload({ config });
    const data = (await req.json()) as InpostWebhookRequest;
    console.log(data);
    if (data.event === "shipment_status_changed") {
      switch (data.payload.status) {
        case "confirmed": {
          await payload.update({
            collection: "orders",
            where: {
              "printLabel.packageNumber": {
                equals: data.payload.shipment_id,
              },
            },
            data: {
              orderDetails: {
                status: "processing",
              },
            },
          });
          break;
        }
        case "dispatched_by_sender":
        case "collected_from_sender":
        case "taken_by_courier": {
          await payload.update({
            collection: "orders",
            where: {
              "printLabel.packageNumber": {
                equals: data.payload.shipment_id,
              },
            },
            data: {
              orderDetails: {
                status: "shipped",
              },
            },
          });
          break;
        }
        case "delivered":
        case "ready_to_pickup_from_pok":
        case "ready_to_pickup_from_branch":
        case "ready_to_pickup_from_pok_registered":
        case "ready_to_pickup": {
          await payload.update({
            collection: "orders",
            where: {
              "printLabel.packageNumber": {
                equals: data.payload.shipment_id,
              },
            },
            data: {
              orderDetails: {
                status: "completed",
              },
            },
          });
        }
      }
    }

    return Response.json({ status: 200 });
  } catch {
    return Response.json({ status: 400 });
  }
}
