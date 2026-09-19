type DeliveryEventActor = {
  eventType: string;
  actorDisplayName: string | null;
};

export function deliveryEventActorLabel(event: DeliveryEventActor) {
  if (event.actorDisplayName) return `Inspector: ${event.actorDisplayName}`;
  if (event.eventType === "viewed") return "Client activity";
  return "System-generated event";
}