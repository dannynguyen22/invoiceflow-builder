// Drag-and-drop payload types. Kept distinct so a drop target knows the gesture semantics.
export const DND = {
  field: "application/x-invoiceflow-field",
  column: "application/x-invoiceflow-column",
  token: "application/x-invoiceflow-token",
} as const;

/** dataTransfer data is unreadable during dragover; track the dragged token's document here. */
export const dragSession: { tokenDocumentId: string | null } = { tokenDocumentId: null };

export const hasType = (e: React.DragEvent, type: string) => Array.from(e.dataTransfer.types).includes(type);
