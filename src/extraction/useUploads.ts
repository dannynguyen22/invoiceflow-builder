import { useSyncExternalStore } from "react";
import { uploads, type UploadItem } from "./store";

const EMPTY: readonly UploadItem[] = [];
/** Subscribe to the session upload batch; empty during SSR. */
export const useUploads = () => useSyncExternalStore(uploads.subscribe, uploads.getSnapshot, () => EMPTY);
